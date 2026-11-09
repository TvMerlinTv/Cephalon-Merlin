//! Bildschirmaufnahme und Texterkennung – direkt in Rust statt per PowerShell-Prozess.
//!
//! - Aufnahme per GDI (BitBlt) vom Hauptmonitor. Unser Overlay-Fenster ist per
//!   WDA_EXCLUDEFROMCAPTURE ausgeschlossen und taucht in der Aufnahme nicht auf.
//! - Texterkennung mit der eingebauten Windows-OCR (Windows.Media.Ocr, englisch).
//!   Bilder gehen direkt aus dem Speicher an die OCR – keine JPG-Dateien mehr im Temp-Ordner.
//! - Die OCR läuft in einem eigenen Thread (WinRT braucht einen initialisierten Thread);
//!   Anfragen kommen über einen Kanal, wie früher an den PowerShell-Prozess.
use serde::Serialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Clone, Debug)]
pub struct Word {
    pub t: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// BGRA-Bild (4 Byte pro Pixel, Zeilen ohne Lücken).
#[derive(Clone)]
pub struct Image {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl Image {
    pub fn crop(&self, x: usize, y: usize, w: usize, h: usize) -> Image {
        let x = x.min(self.width);
        let y = y.min(self.height);
        let w = w.min(self.width - x);
        let h = h.min(self.height - y);
        let mut data = Vec::with_capacity(w * h * 4);
        for row in y..y + h {
            let start = (row * self.width + x) * 4;
            data.extend_from_slice(&self.data[start..start + w * 4]);
        }
        Image { width: w, height: h, data }
    }

    /// Bilineare Skalierung (für Zoom 2× bei kleiner Schrift bzw. 0,75×).
    pub fn resize(&self, nw: usize, nh: usize) -> Image {
        let (nw, nh) = (nw.max(1), nh.max(1));
        let mut data = vec![0u8; nw * nh * 4];
        let sx = self.width as f32 / nw as f32;
        let sy = self.height as f32 / nh as f32;
        for y in 0..nh {
            let fy = ((y as f32 + 0.5) * sy - 0.5).max(0.0);
            let y0 = (fy as usize).min(self.height - 1);
            let y1 = (y0 + 1).min(self.height - 1);
            let dy = fy - y0 as f32;
            for x in 0..nw {
                let fx = ((x as f32 + 0.5) * sx - 0.5).max(0.0);
                let x0 = (fx as usize).min(self.width - 1);
                let x1 = (x0 + 1).min(self.width - 1);
                let dx = fx - x0 as f32;
                for c in 0..4 {
                    let p = |xx: usize, yy: usize| self.data[(yy * self.width + xx) * 4 + c] as f32;
                    let top = p(x0, y0) * (1.0 - dx) + p(x1, y0) * dx;
                    let bot = p(x0, y1) * (1.0 - dx) + p(x1, y1) * dx;
                    data[(y * nw + x) * 4 + c] = (top * (1.0 - dy) + bot * dy).round() as u8;
                }
            }
        }
        Image { width: nw, height: nh, data }
    }

    /// Nur helle, graue Pixel (Schrift) behalten: schwarz auf weiß – blendet Relikt-Bilder aus.
    pub fn text_mask(&mut self) {
        for px in self.data.chunks_exact_mut(4) {
            let mx = px[0].max(px[1]).max(px[2]);
            let mn = px[0].min(px[1]).min(px[2]);
            let v = if mx >= 120 && mx - mn <= 50 { 0 } else { 255 };
            px[0] = v;
            px[1] = v;
            px[2] = v;
            px[3] = 255;
        }
    }

    /// Rechteck schwärzen (Bild-Koordinaten).
    pub fn blank(&mut self, x0: i64, y0: i64, x1: i64, y1: i64) {
        let (x0, x1) = (x0.clamp(0, self.width as i64) as usize, x1.clamp(0, self.width as i64) as usize);
        let (y0, y1) = (y0.clamp(0, self.height as i64) as usize, y1.clamp(0, self.height as i64) as usize);
        for y in y0..y1 {
            for x in x0..x1 {
                let i = (y * self.width + x) * 4;
                self.data[i..i + 3].fill(0);
            }
        }
    }

    pub fn pixel(&self, x: usize, y: usize) -> (u8, u8, u8) {
        let i = (y * self.width + x) * 4;
        (self.data[i + 2], self.data[i + 1], self.data[i])
    }
}

// ---------- Aufnahme ----------
#[cfg(windows)]
pub fn capture_primary() -> Result<Image, String> {
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        if w <= 0 || h <= 0 {
            return Err("Kein Bildschirm zum Aufnehmen gefunden.".into());
        }
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        let ok = BitBlt(mem, 0, 0, w, h, Some(screen), 0, 0, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // von oben nach unten
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut data = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, h as u32, Some(data.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if ok.is_err() || lines == 0 {
            return Err("Bildschirmaufnahme fehlgeschlagen.".into());
        }
        // GDI liefert Alpha = 0 – für die OCR (Premultiplied) wäre das Bild sonst unsichtbar
        for a in data.iter_mut().skip(3).step_by(4) {
            *a = 255;
        }
        Ok(Image { width: w as usize, height: h as usize, data })
    }
}

/// Name des Programms im Vordergrund (z. B. "Warframe.x64"), "" wenn unbekannt.
#[cfg(windows)]
pub fn foreground_process() -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return String::new();
        }
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        if ok.is_err() {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit('\\').next().unwrap_or("");
        file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
    }
}

// ---------- OCR-Thread ----------
type Job = (Image, Sender<Result<Vec<Word>, String>>);
static OCR: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();

/// OCR-Thread gleich beim Start anlegen – nicht erst mitten in der Relikt-Auswahl.
pub fn warm_up() {
    OCR.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::Builder::new()
            .name("ocr".into())
            .spawn(move || {
                let engine = imp::Engine::new();
                if let Err(e) = &engine {
                    crate::logger::error("ocr", format!("Texterkennung nicht verfügbar: {e}"));
                }
                for (img, reply) in rx {
                    let r = match &engine {
                        Ok(en) => en.recognize(&img),
                        Err(e) => Err(e.clone()),
                    };
                    let _ = reply.send(r);
                }
            })
            .expect("OCR-Thread");
        Mutex::new(tx)
    });
}

/// Wörter mit Positionen (Bild-Pixel) – blockiert, daher aus spawn_blocking aufrufen.
pub fn recognize(img: Image) -> Result<Vec<Word>, String> {
    warm_up();
    let (tx, rx) = channel();
    OCR.get().unwrap().lock().map_err(|_| "OCR gesperrt")?.send((img, tx)).map_err(|_| "OCR-Thread beendet")?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "Texterkennung antwortet nicht".to_string())?
}

#[cfg(windows)]
mod imp {
    use super::{Image, Word};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    pub struct Engine {
        engine: OcrEngine,
        max_dim: u32,
    }

    impl Engine {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let en = Language::CreateLanguage(&HSTRING::from("en-US")).map_err(|e| e.to_string())?;
            let engine = OcrEngine::TryCreateFromLanguage(&en)
                .or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages())
                .map_err(|_| "Keine Windows-Texterkennung installiert (Sprachpaket Englisch).".to_string())?;
            let max_dim = OcrEngine::MaxImageDimension().unwrap_or(2600);
            Ok(Engine { engine, max_dim })
        }

        pub fn recognize(&self, img: &Image) -> Result<Vec<Word>, String> {
            // Zu große Bilder verkleinern (OCR-Grenze) und Positionen zurückrechnen
            let longest = img.width.max(img.height) as u32;
            let (src, scale) = if longest > self.max_dim {
                let f = self.max_dim as f64 / longest as f64;
                (img.resize((img.width as f64 * f) as usize, (img.height as f64 * f) as usize), f)
            } else {
                (img.clone(), 1.0)
            };
            let writer = DataWriter::new().map_err(|e| e.to_string())?;
            writer.WriteBytes(&src.data).map_err(|e| e.to_string())?;
            let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
            let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
                &buffer,
                BitmapPixelFormat::Bgra8,
                src.width as i32,
                src.height as i32,
                BitmapAlphaMode::Premultiplied,
            )
            .map_err(|e| e.to_string())?;
            let result = self.engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            let mut words = Vec::new();
            for line in result.Lines().map_err(|e| e.to_string())? {
                for w in line.Words().map_err(|e| e.to_string())? {
                    let r = w.BoundingRect().map_err(|e| e.to_string())?;
                    words.push(Word {
                        t: w.Text().map(|s| s.to_string()).unwrap_or_default(),
                        x: (r.X as f64 / scale).round(),
                        y: (r.Y as f64 / scale).round(),
                        w: (r.Width as f64 / scale).round(),
                        h: (r.Height as f64 / scale).round(),
                    });
                }
            }
            let _ = bitmap.Close();
            Ok(words)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Image, Word};
    pub struct Engine;
    impl Engine {
        pub fn new() -> Result<Self, String> {
            Err("Texterkennung gibt es nur unter Windows.".into())
        }
        pub fn recognize(&self, _img: &Image) -> Result<Vec<Word>, String> {
            unreachable!()
        }
    }
}

/// Aufnahme + OCR messen (gibt nur Anzahl und Zeiten aus): cargo test ocr::bench -- --ignored --nocapture
#[cfg(test)]
#[test]
#[ignore]
fn bench() {
    let t = std::time::Instant::now();
    let shot = capture_primary().unwrap();
    let cap = t.elapsed();
    let region = shot.crop(0, 0, shot.width * 71 / 100, shot.height * 80 / 100);
    let t2 = std::time::Instant::now();
    let words = recognize(region.clone()).unwrap();
    let first = t2.elapsed();
    let t3 = std::time::Instant::now();
    let again = recognize(region).unwrap();
    println!(
        "Bildschirm {}x{} · Aufnahme {:?} · OCR erster Lauf {:?} ({} Wörter) · zweiter Lauf {:?} ({} Wörter)",
        shot.width, shot.height, cap, first, words.len(), t3.elapsed(), again.len()
    );
}

#[cfg(test)]
#[test]
#[ignore]
fn capture_stats() {
    let shot = capture_primary().unwrap();
    let (mut sum, mut nonblack) = (0u64, 0u64);
    for px in shot.data.chunks_exact(4) {
        let v = px[0] as u64 + px[1] as u64 + px[2] as u64;
        sum += v;
        if v > 30 {
            nonblack += 1;
        }
    }
    let n = (shot.width * shot.height) as u64;
    println!("Helligkeit {:.1} · nicht schwarz {:.1} %", sum as f64 / n as f64 / 3.0, nonblack as f64 * 100.0 / n as f64);
}

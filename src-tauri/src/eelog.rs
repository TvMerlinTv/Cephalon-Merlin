//! Ein gemeinsamer Leser für %LOCALAPPDATA%\Warframe\EE.log (nur lesen).
//!
//! Vorher lasen Overlay (0,5 s), Auto-Sync (2 s) und Discord (15 s) die Datei jeweils selbst.
//! Jetzt gibt es einen Thread, der alle 0,5 s nur neue Bytes liest und sie an alle Abonnenten
//! verteilt – so sehen alle dieselben Zeilen in derselben Reihenfolge.
//!
//! Ereignisse:
//!  - `Reset(text)`: beim ersten Lesen und nach jedem Spielneustart (Datei kleiner oder neu angelegt)
//!    mit dem bisherigen Inhalt – daraus holen sich Auto-Sync („Logged in“) und Discord (Ort) den Stand.
//!  - `Lines(zeilen)`: neue, vollständige Zeilen (EE.log ist Latin-1: jedes Byte ein Zeichen).
//!
//! Abonnieren muss man vor `start()` (passiert beim App-Start), sonst fehlt der erste `Reset`.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};
use tokio::sync::broadcast;

#[derive(Debug)]
pub enum Event {
    Reset(String),
    Lines(Vec<String>),
}

pub type Rx = broadcast::Receiver<Arc<Event>>;

const POLL: Duration = Duration::from_millis(500);
/// Pufferplätze je Abonnent; bei 0,5 s Takt reicht das für über eine Minute Rückstand.
const CAPACITY: usize = 128;

fn sender() -> &'static broadcast::Sender<Arc<Event>> {
    static TX: OnceLock<broadcast::Sender<Arc<Event>>> = OnceLock::new();
    TX.get_or_init(|| broadcast::channel(CAPACITY).0)
}

pub fn subscribe() -> Rx {
    sender().subscribe()
}

pub fn path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Warframe").join("EE.log"))
}

/// Zustand des Mitlesens – getrennt vom Thread, damit es sich testen lässt.
#[derive(Default)]
pub struct Tail {
    pos: Option<u64>,
    born: Option<SystemTime>,
    rest: String,
}

impl Tail {
    /// Liest, was seit dem letzten Aufruf dazugekommen ist.
    pub fn poll(&mut self, file: &Path) -> Vec<Event> {
        let Ok(meta) = std::fs::metadata(file) else { return vec![] };
        let size = meta.len();
        let born = meta.created().ok();
        let mut out = Vec::new();
        let restarted = self.pos.is_some_and(|p| size < p) || (self.pos.is_some() && born != self.born);
        if self.pos.is_none() || restarted {
            // Erstes Lesen bzw. Spielneustart: bisherigen Inhalt als Stand liefern
            self.born = born;
            self.rest.clear();
            let text = read_range(file, 0, size);
            // Nur bis zur letzten vollständigen Zeile; der Rest kommt mit dem nächsten Lesen
            let end = text.rfind('\n').map_or(0, |i| i + 1);
            self.pos = Some(end as u64);
            out.push(Event::Reset(text[..end].to_string()));
            return out;
        }
        let pos = self.pos.unwrap_or(0);
        if size == pos {
            return out;
        }
        let data = read_range(file, pos, size);
        self.pos = Some(pos + data.len() as u64);
        self.rest.push_str(&data);
        let Some(last_nl) = self.rest.rfind('\n') else { return out };
        let tail = self.rest.split_off(last_nl + 1);
        let lines: Vec<String> = self.rest.split('\n').filter(|l| !l.is_empty()).map(|l| l.trim_end_matches('\r').to_string()).collect();
        self.rest = tail;
        if !lines.is_empty() {
            out.push(Event::Lines(lines));
        }
        out
    }
}

/// Bytes [start, end) als Latin-1-Text.
fn read_range(file: &Path, start: u64, end: u64) -> String {
    let Ok(mut f) = std::fs::File::open(file) else { return String::new() };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.take(end.saturating_sub(start)).read_to_end(&mut buf);
    buf.iter().map(|&b| b as char).collect()
}

/// Startet den Lese-Thread (einmal, nach dem Abonnieren).
pub fn start() {
    let Some(file) = path() else { return };
    let _ = std::thread::Builder::new().name("ee-log".into()).spawn(move || {
        let mut tail = Tail::default();
        loop {
            for ev in tail.poll(&file) {
                // Kein Abonnent mehr (App beendet sich): einfach weiterlaufen ist harmlos
                let _ = sender().send(Arc::new(ev));
            }
            std::thread::sleep(POLL);
        }
    });
}

/// Empfängt das nächste Ereignis; bei Rückstand (Lagged) einfach weiter.
pub async fn recv(rx: &mut Rx) -> Option<Arc<Event>> {
    loop {
        match rx.recv().await {
            Ok(ev) => return Some(ev),
            Err(broadcast::error::RecvError::Lagged(n)) => crate::logger::warn("ee-log", format!("{n} Ereignisse übersprungen")),
            Err(broadcast::error::RecvError::Closed) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn lines(evs: &[Event]) -> Vec<String> {
        evs.iter()
            .flat_map(|e| match e {
                Event::Lines(l) => l.clone(),
                Event::Reset(_) => vec![],
            })
            .collect()
    }

    #[test]
    fn reset_then_new_lines_then_restart() {
        let dir = std::env::temp_dir().join(format!("cm-eelog-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("EE.log");
        std::fs::write(&file, "a Logged in X\r\nhalb").unwrap();
        let mut t = Tail::default();
        let first = t.poll(&file);
        assert!(matches!(&first[..], [Event::Reset(s)] if s == "a Logged in X\r\n"));
        // Halbe Zeile wird erst mit dem Zeilenende geliefert
        std::fs::OpenOptions::new().append(true).open(&file).unwrap().write_all(b"e Zeile\r\nzwei\n").unwrap();
        assert_eq!(lines(&t.poll(&file)), vec!["halbe Zeile", "zwei"]);
        assert!(t.poll(&file).is_empty());
        // Spielneustart: Datei kürzer -> neuer Reset
        std::fs::write(&file, "neu\n").unwrap();
        assert!(matches!(&t.poll(&file)[..], [Event::Reset(s)] if s == "neu\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_is_quiet() {
        let mut t = Tail::default();
        assert!(t.poll(Path::new("C:/gibt/es/nicht/EE.log")).is_empty());
    }
}

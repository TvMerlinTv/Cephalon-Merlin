//! Text in die Windows-Zwischenablage (CF_UNICODETEXT). Klein gehalten, ohne zusätzliches Plugin.

#[cfg(windows)]
pub fn set_text(text: &str) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    const CF_UNICODETEXT: u32 = 13;
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        // Die Zwischenablage kann kurz von einem anderen Programm belegt sein
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            return Err("Zwischenablage ist belegt".into());
        }
        let result = (|| {
            EmptyClipboard();
            let h = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
            if h.is_null() {
                return Err("Kein Speicher".to_string());
            }
            let p = GlobalLock(h) as *mut u16;
            if p.is_null() {
                GlobalFree(h);
                return Err("Kein Speicher".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
            GlobalUnlock(h);
            // Danach gehört der Speicher der Zwischenablage
            if SetClipboardData(CF_UNICODETEXT, h).is_null() {
                GlobalFree(h);
                return Err("Zwischenablage konnte nicht gesetzt werden".to_string());
            }
            Ok(())
        })();
        CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
pub fn set_text(_text: &str) -> Result<(), String> {
    Err("Nur unter Windows".into())
}

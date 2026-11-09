//! Liest den Sitzungs-Token (`?accountId=…&nonce=…`) aus dem laufenden Warframe-Prozess.
//!
//! Gleiches Verfahren wie die Electron-Version (electron/gameReader.ps1) und wie
//! Sainan/warframe-api-helper – nur direkt in Rust statt per PowerShell:
//! - nur Lesezugriff (PROCESS_QUERY_INFORMATION | PROCESS_VM_READ): kein Schreiben, keine Injektion
//! - durchsucht werden nur private, beschreibbare Speicherbereiche
//! - ein Token gilt erst, wenn er 3× identisch im Speicher steht
//! - Bereiche, in denen er zuletzt lag, werden zuerst durchsucht (nur Adressen, kein Token)
//!
//! Der Token verlässt dieses Modul nur in Richtung `game::fetch_inventory` – er wird weder
//! gespeichert noch protokolliert noch an die Oberfläche gegeben.
use std::collections::{HashMap, HashSet};

#[derive(Debug)]
pub enum ReadError {
    NotRunning,
    OpenFailed,
    NotFound,
    #[cfg_attr(windows, allow(dead_code))]
    Unsupported,
}

impl ReadError {
    pub fn message(&self) -> &'static str {
        match self {
            ReadError::NotRunning => "Warframe läuft nicht. Starte das Spiel und logge dich ein.",
            ReadError::OpenFailed => "Kein Zugriff auf den Warframe-Prozess (läuft das Spiel als Administrator?).",
            ReadError::NotFound => "Kein Sitzungs-Token gefunden. Geh einmal in einen Ladebildschirm und versuch es erneut.",
            ReadError::Unsupported => "Spiel-Sync gibt es nur unter Windows.",
        }
    }
}

/// Ergebnis: Token und die Startadressen der Bereiche, in denen er lag.
pub struct Found {
    pub token: String,
    pub regions: Vec<usize>,
}

const NEEDLE: &[u8] = b"?accountId=";
const CHUNK: usize = 4 << 20;
const OVERLAP: usize = 128;

/// Prüft einen Treffer an Position `i`: 24 Hex-Zeichen, "&nonce=", 1–20 Ziffern.
fn parse_at(b: &[u8], i: usize) -> Option<String> {
    let mut p = i + NEEDLE.len();
    let id = b.get(p..p + 24)?;
    if !id.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    p += 24;
    if b.get(p..p + 7)? != b"&nonce=" {
        return None;
    }
    p += 7;
    let digits = b[p..].iter().take(20).take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
        return None;
    }
    let mut s = String::with_capacity(NEEDLE.len() + 24 + 7 + digits);
    s.push_str("?accountId=");
    s.push_str(std::str::from_utf8(id).ok()?);
    s.push_str("&nonce=");
    s.push_str(std::str::from_utf8(&b[p..p + digits]).ok()?);
    Some(s)
}

/// Sucht im Puffer nach Tokens; Treffer, die im Überlappungsbereich beginnen, zählt erst der nächste Block.
/// Gibt einen Token zurück, sobald er 3× gesehen wurde.
fn scan(b: &[u8], seen: &mut HashMap<String, u32>, hits: &mut u32) -> Option<String> {
    let limit = b.len().min(CHUNK);
    let mut from = 0;
    while from < limit {
        let rel = memchr_find(&b[from..], NEEDLE)?;
        let i = from + rel;
        if i >= limit {
            return None;
        }
        if let Some(tok) = parse_at(b, i) {
            *hits += 1;
            let n = seen.entry(tok.clone()).or_insert(0);
            *n += 1;
            if *n >= 3 {
                return Some(tok);
            }
        }
        from = i + 1;
    }
    None
}

/// Einfache Teilstring-Suche: erst das seltene '?'-Byte, dann der Rest.
fn memchr_find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    let first = needle[0];
    let mut start = 0;
    while let Some(pos) = hay[start..].iter().position(|&c| c == first) {
        let i = start + pos;
        if hay.len() - i < needle.len() {
            return None;
        }
        if &hay[i..i + needle.len()] == needle {
            return Some(i);
        }
        start = i + 1;
    }
    None
}

/// Läuft Warframe gerade? (nur Prozessliste, kein Speicherzugriff)
#[cfg(windows)]
pub fn game_running() -> bool {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut e: PROCESSENTRY32W = zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case("Warframe.x64.exe") {
                    found = true;
                    break;
                }
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        found
    }
}
#[cfg(not(windows))]
pub fn game_running() -> bool {
    false
}

#[cfg(windows)]
pub fn find_token(hints: &[usize]) -> Result<Found, ReadError> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Memory::{
        VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_PRIVATE, PAGE_GUARD, PAGE_READWRITE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

    // Prozess "Warframe.x64.exe" suchen
    let pid = unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Err(ReadError::NotRunning);
        }
        let mut e: PROCESSENTRY32W = zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut pid = None;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..len]);
                if name.eq_ignore_ascii_case("Warframe.x64.exe") {
                    pid = Some(e.th32ProcessID);
                    break;
                }
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        pid.ok_or(ReadError::NotRunning)?
    };

    let h: HANDLE = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if h.is_null() {
        return Err(ReadError::OpenFailed);
    }
    struct Guard(HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }
    let _guard = Guard(h);

    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut hit_regions: Vec<usize> = Vec::new();
    let mut done: HashSet<usize> = HashSet::new();
    let mut hits: u32 = 0;
    let mut buf = vec![0u8; CHUNK + OVERLAP];

    let query = |addr: usize| -> Option<MEMORY_BASIC_INFORMATION> {
        let mut m: MEMORY_BASIC_INFORMATION = unsafe { zeroed() };
        let n = unsafe { VirtualQueryEx(h, addr as *const _, &mut m, size_of::<MEMORY_BASIC_INFORMATION>()) };
        (n != 0).then_some(m)
    };

    let mut scan_region = |m: &MEMORY_BASIC_INFORMATION,
                           seen: &mut HashMap<String, u32>,
                           hit_regions: &mut Vec<usize>,
                           hits: &mut u32|
     -> Option<String> {
        let start = m.BaseAddress as usize;
        let size = m.RegionSize;
        let ok = m.State == MEM_COMMIT
            && m.Type == MEM_PRIVATE
            && (m.Protect & PAGE_READWRITE) != 0
            && (m.Protect & PAGE_GUARD) == 0;
        if !ok || !done.insert(start) {
            return None;
        }
        let before = *hits;
        let mut result = None;
        let mut off = 0;
        while off < size && result.is_none() {
            let want = (CHUNK + OVERLAP).min(size - off);
            let mut got: usize = 0;
            let read = unsafe {
                ReadProcessMemory(h, (start + off) as *const _, buf.as_mut_ptr().cast(), want, &mut got)
            };
            if read != 0 && got > 0 {
                result = scan(&buf[..got], seen, hits);
            }
            off += CHUNK;
        }
        if *hits != before {
            hit_regions.push(start);
        }
        result
    };

    // 1) Zuerst die Bereiche vom letzten Mal
    for &hint in hints {
        if let Some(m) = query(hint) {
            if let Some(tok) = scan_region(&m, &mut seen, &mut hit_regions, &mut hits) {
                return Ok(Found { token: tok, regions: hit_regions });
            }
        }
    }
    // 2) Kompletter Durchlauf
    let mut addr: usize = 0;
    while let Some(m) = query(addr) {
        if let Some(tok) = scan_region(&m, &mut seen, &mut hit_regions, &mut hits) {
            return Ok(Found { token: tok, regions: hit_regions });
        }
        let next = (m.BaseAddress as usize).saturating_add(m.RegionSize);
        if next <= addr {
            break;
        }
        addr = next;
    }
    // Kein Token 3× gefunden: den häufigsten Kandidaten versuchen
    seen.into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(token, _)| Found { token, regions: hit_regions })
        .ok_or(ReadError::NotFound)
}

#[cfg(not(windows))]
pub fn find_token(_hints: &[usize]) -> Result<Found, ReadError> {
    Err(ReadError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_token_three_times() {
        let tok = b"?accountId=0123456789abcdef01234567&nonce=987654321";
        let mut buf = Vec::new();
        for _ in 0..3 {
            buf.extend_from_slice(b"xx??");
            buf.extend_from_slice(tok);
            buf.extend_from_slice(b"\0junk");
        }
        let mut seen = HashMap::new();
        let mut hits = 0;
        let r = scan(&buf, &mut seen, &mut hits);
        assert_eq!(r.as_deref(), Some(std::str::from_utf8(tok).unwrap()));
        assert_eq!(hits, 3);
    }

    #[test]
    fn rejects_bad_tokens() {
        let mut seen = HashMap::new();
        let mut hits = 0;
        assert!(scan(b"?accountId=zz23456789abcdef01234567&nonce=1", &mut seen, &mut hits).is_none());
        assert!(scan(b"?accountId=0123456789abcdef01234567&nonce=x", &mut seen, &mut hits).is_none());
        assert_eq!(hits, 0);
    }
}

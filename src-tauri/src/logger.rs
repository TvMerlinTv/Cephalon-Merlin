//! Fehlerprotokoll im Datenordner: logs\cephalon-merlin.log (wie in der Electron-Version).
//! Ab 1 MB wird die Datei nach *.old.log verschoben. Gleiche Meldungen hintereinander
//! werden zusammengefasst. Protokollieren darf die App nie stören – Fehler hier werden geschluckt.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 1024 * 1024;

struct State {
    dir: Option<PathBuf>,
    last: String,
    repeats: u32,
}

static STATE: Mutex<State> = Mutex::new(State { dir: None, last: String::new(), repeats: 0 });

pub fn init(data_dir: &std::path::Path) {
    if let Ok(mut s) = STATE.lock() {
        s.dir = Some(data_dir.join("logs"));
    }
}

pub fn log_file() -> Option<PathBuf> {
    STATE.lock().ok()?.dir.as_ref().map(|d| d.join("cephalon-merlin.log"))
}

/// ISO-Zeitstempel (UTC) ohne zusätzliche Crates.
pub fn now_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Tage seit 1970 -> Datum (Algorithmus von Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        d.subsec_millis()
    )
}

pub fn write(level: &str, source: &str, msg: &str) {
    let text: String = msg.trim_end().chars().take(4000).collect();
    let Ok(mut s) = STATE.lock() else { return };
    let key = format!("{level}|{source}|{text}");
    if key == s.last {
        s.repeats += 1;
        return;
    }
    let Some(dir) = s.dir.clone() else { return };
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("cephalon-merlin.log");
    if fs::metadata(&file).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = fs::rename(&file, dir.join("cephalon-merlin.old.log"));
    }
    let mut line = String::new();
    if s.repeats > 0 {
        line.push_str(&format!("{}  INFO  [log] vorherige Meldung {}× wiederholt\n", now_iso(), s.repeats));
    }
    line.push_str(&format!("{}  {:<5} [{}] {}\n", now_iso(), level, source, text));
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = f.write_all(line.as_bytes());
    }
    s.last = key;
    s.repeats = 0;
}

pub fn info(source: &str, msg: impl AsRef<str>) {
    write("INFO", source, msg.as_ref());
}
pub fn warn(source: &str, msg: impl AsRef<str>) {
    write("WARN", source, msg.as_ref());
}
pub fn error(source: &str, msg: impl AsRef<str>) {
    write("ERROR", source, msg.as_ref());
}

/// Panics landen im Protokoll (im Release-Build gibt es keine Konsole).
pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        error("panic", info.to_string());
        prev(info);
    }));
}

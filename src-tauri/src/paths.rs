//! Datenordner.
//!
//! Die Rust-Version nutzt während der Preview-Phase einen eigenen Ordner
//! (%APPDATA%\Cephalon Merlin RS). Beim ersten Start werden die Daten der Electron-Version
//! (%APPDATA%\Cephalon Merlin, davor %APPDATA%\tennodeck) einmalig hineinkopiert – der alte
//! Ordner bleibt unangetastet, beide Apps kommen sich so nicht in die Quere.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const DIR_NAME: &str = "Cephalon Merlin RS";
const LEGACY_NAMES: [&str; 2] = ["Cephalon Merlin", "tennodeck"];

/// Daran erkennt man einen Ordner mit echten Daten.
const MARKERS: [&str; 4] = ["settings.json", "inventory.json", "todo.json", "stats.json"];

/// Diese Dateien werden übernommen. Bewusst nicht: Caches (werden neu geladen) und
/// discord-webhook.json (von Electron verschlüsselt, nur dort lesbar – Webhook neu eintragen).
const MIGRATE_FILES: [&str; 11] = [
    "settings.json",
    "inventory.json",
    "todo.json",
    "stats.json",
    "builds.json",
    "alerts.json",
    "foundry.json",
    "worldchecks.json",
    "reward-log.json",
    "player.json",
    "glyph.json",
];

fn appdata() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn has_data(dir: &Path) -> bool {
    MARKERS.iter().any(|f| dir.join(f).is_file())
}

pub fn data_dir() -> PathBuf {
    let dir = appdata().join(DIR_NAME);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Ordner der Electron-Version mit Daten (falls vorhanden).
pub fn legacy_dir() -> Option<PathBuf> {
    LEGACY_NAMES.iter().map(|n| appdata().join(n)).find(|d| has_data(d))
}

#[derive(Serialize, Clone, Default)]
pub struct Migration {
    pub from: Option<String>,
    pub copied: Vec<String>,
    pub at: Option<String>,
}

const MIGRATION_FILE: &str = "migration.json";

pub fn last_migration(data: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(data.join(MIGRATION_FILE)).ok()?).ok()
}

/// Kopiert die Daten der Electron-Version. Ohne `force` nur, wenn hier noch nichts liegt.
/// Mit `force` werden vorhandene Dateien vorher nach backup\<zeit>\ gesichert.
pub fn migrate(data: &Path, force: bool) -> Result<Migration, String> {
    if !force && has_data(data) {
        return Ok(Migration::default());
    }
    let Some(from) = legacy_dir() else {
        return Ok(Migration::default());
    };
    let stamp = crate::logger::now_iso().replace([':', '.'], "-");
    let backup = data.join("backup").join(&stamp);
    let mut copied = Vec::new();
    for name in MIGRATE_FILES {
        let src = from.join(name);
        if !src.is_file() {
            continue;
        }
        let dst = data.join(name);
        if force && dst.is_file() {
            fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
            fs::copy(&dst, backup.join(name)).map_err(|e| format!("Sicherung von {name}: {e}"))?;
        }
        fs::copy(&src, &dst).map_err(|e| format!("Kopieren von {name}: {e}"))?;
        copied.push(name.to_string());
    }
    let m = Migration { from: Some(from.display().to_string()), copied, at: Some(crate::logger::now_iso()) };
    let _ = fs::write(data.join(MIGRATION_FILE), serde_json::to_string_pretty(&serde_json::json!({
        "from": m.from, "copied": m.copied, "at": m.at
    })).unwrap_or_default());
    Ok(m)
}

/// Atomisch schreiben: erst *.tmp, dann umbenennen – so ist eine Datei nie halb geschrieben.
pub fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

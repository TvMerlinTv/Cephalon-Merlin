//! Kleine Datenablage im Datenordner (To-Do-Liste, Builds, Preis-Alarme …) – je Schlüssel eine
//! JSON-Datei, gleiche Namen wie in der Electron-Version.
use serde_json::Value;
use std::path::Path;

const KEYS: [&str; 5] = ["todo", "builds", "alerts", "worldchecks", "foundry"];
const MAX_LEN: usize = 200_000;

fn check(key: &str) -> Result<(), String> {
    if KEYS.contains(&key) { Ok(()) } else { Err("Unbekannter Speicher".into()) }
}

pub fn get(data: &Path, key: &str) -> Result<Value, String> {
    check(key)?;
    Ok(std::fs::read_to_string(data.join(format!("{key}.json")))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null))
}

pub fn set(data: &Path, key: &str, value: &Value) -> Result<(), String> {
    check(key)?;
    let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if text.len() > MAX_LEN {
        return Err("Zu groß".into());
    }
    crate::paths::write_atomic(&data.join(format!("{key}.json")), &text).map_err(|e| e.to_string())
}

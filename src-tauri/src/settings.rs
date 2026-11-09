//! Einstellungen: settings.json im Datenordner – gleiches Format wie die Electron-Version,
//! damit eine übernommene Datei einfach weiter gilt. Unbekannte Schlüssel bleiben erhalten.
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const THEMES: [&str; 7] = ["default", "ocean", "emerald", "ember", "orokin", "kuva", "midnight"];
pub const HOTKEYS: [&str; 11] = ["Home", "End", "Insert", "PageUp", "PageDown", "F9", "F10", "F11", "F12", "ScrollLock", "Pause"];

pub fn defaults() -> Value {
    json!({
        "language": "de",
        "theme": "default",
        "accent": "",
        "colors": {},
        "radius": 12,
        "uiScale": 1,
        "confirmClose": true,
        "hideFounders": false,
        "secondMonitor": false,
        "autoSync": false,
        "autoSyncMission": true,
        "autoSyncMinutes": 0,
        "rewardsOverlay": true,
        "selectionOverlay": true,
        "walletOnOverlay": true,
        "copyRewards": false,
        "rewardsScale": 1.2,
        "hotkey": "Home",
        "notify": true,
        "notifyCycles": { "earth": false, "cetus": true, "vallis": false, "cambion": false },
        "notifyMinutes": 3,
        "notifyBaro": true,
        "notifyBaroDucats": true,
        "notifySortie": false,
        "notifyArchon": false,
        "notifyFoundry": true,
        "notifyPriceAlerts": true,
        "priceAlertMinutes": 10,
        "discordRpc": false,
        "discordAppId": "",
        "discordShowMr": true,
        "discordShowActivity": true,
        "discordShowName": false,
        "discordIdle": false,
        "discordButton": true,
        "discordHooks": { "priceAlert": true, "foundry": true, "baro": true, "world": false }
    })
}

pub struct Settings {
    file: PathBuf,
    values: Mutex<Map<String, Value>>,
}

fn merged(mut base: Map<String, Value>, over: Map<String, Value>) -> Map<String, Value> {
    for (k, v) in over {
        base.insert(k, v);
    }
    base
}

/// Prüft und korrigiert einzelne Werte (falsche Werte werden verworfen bzw. begrenzt).
fn sanitize(key: &str, v: Value) -> Option<Value> {
    let num = |min: f64, max: f64| v.as_f64().map(|n| json!(n.clamp(min, max)));
    match key {
        "language" => matches!(v.as_str(), Some("de" | "en")).then_some(v),
        "theme" => v.as_str().filter(|t| THEMES.contains(t)).map(|_| v.clone()),
        "hotkey" => v.as_str().filter(|t| HOTKEYS.contains(t)).map(|_| v.clone()),
        "uiScale" => num(0.01, 2.0),
        "rewardsScale" => num(0.5, 3.0),
        "radius" => num(0.0, 20.0),
        "notifyMinutes" => num(0.0, 60.0),
        "autoSyncMinutes" => num(0.0, 120.0),
        "priceAlertMinutes" => num(5.0, 30.0),
        "discordAppId" => v.as_str().filter(|s| s.is_empty() || (s.len() <= 21 && s.chars().all(|c| c.is_ascii_digit()))).map(|_| v.clone()),
        _ => Some(v),
    }
}

impl Settings {
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("settings.json");
        let base = defaults().as_object().cloned().unwrap_or_default();
        let stored = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        let clean = stored.into_iter().filter_map(|(k, v)| sanitize(&k, v).map(|v| (k, v))).collect();
        Self { file, values: Mutex::new(merged(base, clean)) }
    }

    pub fn get(&self) -> Value {
        Value::Object(self.values.lock().map(|v| v.clone()).unwrap_or_default())
    }

    pub fn bool(&self, key: &str) -> bool {
        self.values.lock().ok().and_then(|v| v.get(key).and_then(Value::as_bool)).unwrap_or(false)
    }

    /// Übernimmt einen Teil-Patch (oberste Ebene, Objekte werden als Ganzes ersetzt) und speichert.
    pub fn update(&self, patch: Value) -> Result<Value, String> {
        let Value::Object(patch) = patch else { return Err("Ungültige Einstellungen".into()) };
        let mut values = self.values.lock().map_err(|_| "Einstellungen gesperrt")?;
        for (k, v) in patch {
            if let Some(v) = sanitize(&k, v) {
                values.insert(k, v);
            }
        }
        let text = serde_json::to_string_pretty(&*values).map_err(|e| e.to_string())?;
        crate::paths::write_atomic(&self.file, &text).map_err(|e| format!("settings.json: {e}"))?;
        Ok(Value::Object(values.clone()))
    }
}

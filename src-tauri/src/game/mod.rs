//! Spieldaten: Sync mit dem laufenden Spiel, letztes Inventar, Import, Statistik-Verlauf.
//!
//! Ablauf wie in der Electron-Version: Sitzungs-Token read-only aus dem Spielprozess lesen
//! (reader.rs) und damit das eigene Inventar von DE laden. Der Token bleibt in dieser Datei –
//! er wird weder gespeichert noch protokolliert noch an die Oberfläche gegeben.
pub mod reader;
pub mod stats;
pub mod summary;

use crate::net::{client, err_text, now_ms};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use tokio::sync::Mutex;

/// Speicherbereiche, in denen der Token zuletzt lag (nur Adressen) – der nächste Scan ist dann meist in Sekunden fertig.
static REGION_HINT: StdMutex<Vec<usize>> = StdMutex::new(Vec::new());
/// Laufende Foundry-Aufträge aus dem letzten Inventar (für die Fertig-Meldung im Hintergrund).
pub static LAST_FOUNDRY: StdMutex<Vec<Value>> = StdMutex::new(Vec::new());
/// Läuft schon ein Sync, warten weitere Aufrufe darauf und bekommen dessen Ergebnis.
static RUNNING: Mutex<()> = Mutex::const_new(());
/// Zeitpunkt des letzten Syncs (für den Intervall-Modus des Auto-Syncs); zählt ab App-Start.
static LAST_SYNC: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn note_sync() {
    LAST_SYNC.store(now_ms(), std::sync::atomic::Ordering::Relaxed);
}

pub fn ms_since_sync() -> i64 {
    let last = LAST_SYNC.load(std::sync::atomic::Ordering::Relaxed);
    if last == 0 {
        note_sync();
        return 0;
    }
    now_ms() - last
}

fn inventory_file(data: &Path) -> PathBuf {
    data.join("inventory.json")
}

fn parse_inventory(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text).ok()?;
    v.get("MiscItems").filter(|m| m.is_array())?;
    Some(v)
}

async fn read_token() -> Result<reader::Found, String> {
    let hints = REGION_HINT.lock().map(|h| h.clone()).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || reader::find_token(&hints))
        .await
        .map_err(|e| format!("Leser fehlgeschlagen: {e}"))?
        .map_err(|e| e.message().to_string())
}

async fn fetch_inventory(token: &str) -> Result<(String, Option<Value>), String> {
    let res = client()
        .get(format!("https://mobile.warframe.com/api/inventory.php{token}"))
        .send()
        .await
        .map_err(err_text)?; // err_text entfernt die URL (enthält den Token)
    if !res.status().is_success() {
        return Err(format!("Warframe-API antwortete mit HTTP {}. Später erneut versuchen.", res.status().as_u16()));
    }
    let text = res.text().await.map_err(err_text)?;
    let inv = parse_inventory(&text);
    Ok((text, inv))
}

pub async fn sync(data: &Path) -> Result<Value, String> {
    let Ok(_guard) = RUNNING.try_lock() else {
        // Ein Sync läuft schon: abwarten und dessen Ergebnis liefern
        let _wait = RUNNING.lock().await;
        return load_last(data).await.ok_or_else(|| "Sync fehlgeschlagen.".to_string());
    };
    note_sync();
    let started = std::time::Instant::now();
    let used_hint = REGION_HINT.lock().map(|h| !h.is_empty()).unwrap_or(false);
    let found = read_token().await?;
    let (mut text, mut inv) = fetch_inventory(&found.token).await?;
    let mut regions = found.regions;
    if inv.is_none() && used_hint {
        // Alter Token aus dem gemerkten Bereich? Dann einmal komplett neu suchen.
        if let Ok(mut h) = REGION_HINT.lock() {
            h.clear();
        }
        let again = read_token().await?;
        (text, inv) = fetch_inventory(&again.token).await?;
        regions = again.regions;
    }
    let inv = inv.ok_or("Token abgelaufen – geh in einen Ladebildschirm und synchronisiere erneut.")?;
    if let Ok(mut h) = REGION_HINT.lock() {
        *h = regions;
    }
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&inventory_file(data), &text).map_err(|e| format!("inventory.json: {e}"))?;
    note_sync();
    crate::logger::info("sync", format!("Inventar geladen in {:.1} s", started.elapsed().as_secs_f32()));
    let summary = finish(summary::summarize(&inv, now_ms(), "game"), &inv, data).await;
    if let Err(e) = stats::record(data, &summary) {
        crate::logger::warn("stats", e.to_string());
    }
    Ok(summary)
}

pub async fn import_text(data: &Path, text: String) -> Result<Value, String> {
    let inv = parse_inventory(&text).ok_or("Die Datei ist kein Warframe-Inventar (inventory.json).")?;
    crate::paths::write_atomic(&inventory_file(data), &text).map_err(|e| e.to_string())?;
    let summary = finish(summary::summarize(&inv, now_ms(), "import"), &inv, data).await;
    let _ = stats::record(data, &summary);
    Ok(summary)
}

pub async fn load_last(data: &Path) -> Option<Value> {
    let file = inventory_file(data);
    let text = tokio::fs::read_to_string(&file).await.ok()?;
    let mtime = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms);
    let inv = tauri::async_runtime::spawn_blocking(move || parse_inventory(&text)).await.ok()??;
    Some(finish(summary::summarize(&inv, mtime, "cache"), &inv, data).await)
}

/// Verlauf; ohne Einträge den zuletzt gespeicherten Stand als ersten Punkt nehmen.
pub async fn stats_history(data: &Path) -> Value {
    let list = stats::load(data);
    if !list.is_empty() {
        return json!(list);
    }
    match load_last(data).await {
        Some(s) => json!(stats::record(data, &s).unwrap_or_default()),
        None => json!([]),
    }
}

/// Spielername und Profilbild ergänzen.
async fn finish(mut summary: Value, inv: &Value, data: &Path) -> Value {
    if let Ok(mut f) = LAST_FOUNDRY.lock() {
        *f = summary["foundry"].as_array().cloned().unwrap_or_default();
    }
    let avatar = glyph_image(inv.get("ActiveAvatarImageType").and_then(Value::as_str), data).await;
    let player_file = data.join("player.json");
    let name = match read_player_name() {
        Some(n) => {
            let _ = std::fs::write(&player_file, json!({ "name": n }).to_string());
            Some(n)
        }
        None => std::fs::read_to_string(&player_file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v["name"].as_str().map(String::from)),
    };
    summary["player"]["name"] = json!(name);
    summary["player"]["avatar"] = json!(avatar);
    summary
}

/// Der Spielername steht nicht im Inventar, aber im Spiel-Log: "Logged in <Name>".
fn read_player_name() -> Option<String> {
    let path = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Warframe").join("EE.log");
    let bytes = std::fs::read(path).ok()?;
    let needle = b"Logged in ";
    let pos = bytes.windows(needle.len()).rposition(|w| w == needle)?;
    let rest = &bytes[pos + needle.len()..];
    let end = rest.iter().position(|c| c.is_ascii_whitespace()).unwrap_or(rest.len()).min(64);
    // EE.log ist Latin-1: jedes Byte ein Zeichen
    let name: String = rest[..end].iter().map(|&b| b as char).collect();
    (!name.is_empty()).then_some(name)
}

/// Profilbild = aktiver Glyph. Bildname aus WFCD/warframe-items; gemerkt in glyph.json.
async fn glyph_image(kind: Option<&str>, data: &Path) -> Option<String> {
    let kind = kind?;
    let file = data.join("glyph.json");
    let cached: Option<Value> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok());
    if let Some(c) = &cached {
        if c["type"].as_str() == Some(kind) {
            return c["image"].as_str().map(String::from);
        }
    }
    let old = cached.as_ref().and_then(|c| c["image"].as_str().map(String::from));
    let res = client().get("https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/Glyphs.json").send().await.ok()?;
    if !res.status().is_success() {
        return old;
    }
    let list: Value = res.json().await.ok()?;
    let image = list
        .as_array()?
        .iter()
        .find(|g| g["uniqueName"].as_str() == Some(kind))
        .and_then(|g| g["imageName"].as_str())
        .map(|n| format!("https://cdn.warframestat.us/img/{n}"));
    let _ = std::fs::write(&file, json!({ "type": kind, "image": image }).to_string());
    image.or(old)
}

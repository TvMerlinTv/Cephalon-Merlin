//! Statistik-Verlauf: bei jedem Sync ein Schnappschuss der Kontowerte in stats.json
//! (gleiches Format wie die Electron-Version).
use serde_json::{json, Value};
use std::path::Path;

const MERGE_MS: i64 = 10 * 60 * 1000; // Syncs kurz hintereinander ersetzen den letzten Punkt
const MAX_POINTS: usize = 5000;
const KUVA: &str = "/Lotus/Types/Items/MiscItems/Kuva";

fn snapshot(summary: &Value) -> Value {
    let p = &summary["player"];
    let relics: i64 = summary["relics"]
        .as_object()
        .map(|m| m.values().filter_map(Value::as_object).flat_map(|r| r.values()).filter_map(Value::as_i64).sum())
        .unwrap_or(0);
    json!({
        "t": summary["syncedAt"],
        "platinum": p["platinum"],
        "credits": p["credits"],
        "endo": p["endo"],
        "ducats": p["ducats"],
        "kuva": summary["counts"][KUVA].as_i64().unwrap_or(0),
        "mr": p["mr"],
        "relics": relics,
        "rivens": summary["rivens"]["list"].as_array().map(Vec::len).unwrap_or(0),
        "gear": summary["owned"].as_object().map(|m| m.len()).unwrap_or(0),
    })
}

pub fn load(data: &Path) -> Vec<Value> {
    std::fs::read_to_string(data.join("stats.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok())
        .unwrap_or_default()
}

pub fn record(data: &Path, summary: &Value) -> std::io::Result<Vec<Value>> {
    let point = snapshot(summary);
    let mut list = load(data);
    let t = point["t"].as_i64().unwrap_or(0);
    match list.last_mut() {
        Some(last) if t - last["t"].as_i64().unwrap_or(0) < MERGE_MS => *last = point,
        _ => list.push(point),
    }
    if list.len() > MAX_POINTS {
        list.drain(..list.len() - MAX_POINTS);
    }
    crate::paths::write_atomic(&data.join("stats.json"), &serde_json::to_string(&list)?)?;
    Ok(list)
}

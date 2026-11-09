//! Belohnungs-Log: nach jeder Spalten-Mission die (bis zu) 4 Belohnungen in reward-log.json.
//! Gleiches Format wie electron/rewardLog.cjs. Platin/Ducats rechnet die Oberfläche aus.
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

const SAME_MS: i64 = 5 * 60 * 1000; // gleicher Bildschirm innerhalb von 5 Min. = ein Eintrag
const MAX_RUNS: usize = 5000;
static LOCK: Mutex<()> = Mutex::new(());

pub fn load(data: &Path) -> Vec<Value> {
    std::fs::read_to_string(data.join("reward-log.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(data: &Path, list: &[Value]) -> Result<(), String> {
    let start = list.len().saturating_sub(MAX_RUNS);
    crate::paths::write_atomic(&data.join("reward-log.json"), &serde_json::to_string(&list[start..]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn names_of(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(|n| n.as_str().map(String::from)).collect()
}

/// Ergebnis eines Belohnungs-Scans speichern; gibt den gespeicherten/aktualisierten Eintrag zurück.
pub fn record(data: &Path, result: &Value, relic: Option<Value>) -> Result<Option<Value>, String> {
    let names: Vec<String> = result["items"].as_array().into_iter().flatten().filter_map(|i| i["name"].as_str().map(String::from)).filter(|n| !n.is_empty()).collect();
    if result["mode"] != "rewards" || names.is_empty() {
        return Ok(None);
    }
    let _g = LOCK.lock().map_err(|_| "gesperrt")?;
    let t = result["at"].as_i64().unwrap_or_else(crate::net::now_ms);
    let mut list = load(data);
    let key = |n: &[String]| {
        let mut s = n.to_vec();
        s.sort();
        s.join("|")
    };
    // Teilmenge erst ab 2 Namen – ein einzelnes „Forma Blueprint“ passt sonst zu jedem Run
    let subset = |a: &[String], b: &[String]| a.len() >= 2 && a.iter().all(|n| b.contains(n));
    let k = key(&names);
    let prev = list.iter_mut().rev().find(|r| {
        let items = names_of(&r["items"]);
        (t - r["t"].as_i64().unwrap_or(0)).abs() < SAME_MS && (key(&items) == k || subset(&names, &items) || subset(&items, &names))
    });
    let entry = match prev {
        Some(p) => {
            if names.len() > names_of(&p["items"]).len() {
                p["items"] = json!(names);
            }
            if p["relic"].is_null() {
                if let Some(r) = relic {
                    p["relic"] = r;
                }
            }
            p.clone()
        }
        None => {
            let id = format!("{}{:04x}", radix36(t as u64), (t as u64).wrapping_mul(2654435761) & 0xffff);
            let e = json!({ "id": id, "t": t, "items": names, "chosen": null, "relic": relic });
            list.push(e.clone());
            e
        }
    };
    save(data, &list)?;
    Ok(Some(entry))
}

fn radix36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = Vec::new();
    loop {
        s.push(D[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// Gewählte Belohnung von Hand setzen (None = unbekannt).
pub fn set_choice(data: &Path, id: &str, chosen: Option<String>) -> Result<Option<Value>, String> {
    let _g = LOCK.lock().map_err(|_| "gesperrt")?;
    let mut list = load(data);
    let Some(run) = list.iter_mut().find(|r| r["id"] == id) else { return Ok(None) };
    let items = names_of(&run["items"]);
    run["chosen"] = json!(chosen.filter(|c| items.contains(c)));
    let out = run.clone();
    save(data, &list)?;
    Ok(Some(out))
}

pub fn remove(data: &Path, id: &str) -> Result<bool, String> {
    let _g = LOCK.lock().map_err(|_| "gesperrt")?;
    let mut list = load(data);
    let before = list.len();
    list.retain(|r| r["id"] != id);
    save(data, &list)?;
    Ok(list.len() != before)
}

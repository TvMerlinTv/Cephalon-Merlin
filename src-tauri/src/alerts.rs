//! Preis-Alarme für warframe.market-Items (alerts.json, gleiches Format wie die Electron-Version).
//! Neu: geprüft wird im Rust-Teil – kurz nach dem Start und dann alle X Minuten (Einstellung),
//! unabhängig davon, welche Seite offen ist. Abfragen laufen über die gemeinsame Markt-Warteschlange.
//!
//! Alarm: { id, slug, name, thumb, rank (null = ohne Rang), maxRank, kind: 'wts' | 'wtb', target,
//!          enabled, created, price, checked, triggered, error }
//! 'wts': günstigstes Verkaufsangebot ≤ target · 'wtb': höchstes Kaufgebot ≥ target.
//! Gemeldet wird nur beim Übergang „nicht erfüllt → erfüllt“.
use crate::net::now_ms;
use crate::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Änderungen an alerts.json nacheinander (kurz gehalten).
static LOCK: Mutex<()> = Mutex::const_new(());
/// Prüf-Läufe nacheinander, nie zwei gleichzeitig (hält die Datei während der Abfragen nicht gesperrt).
static RUN: Mutex<()> = Mutex::const_new(());

fn load(data: &Path) -> Vec<Value> {
    std::fs::read_to_string(data.join("alerts.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, data: &Path, list: &[Value]) {
    let _ = crate::paths::write_atomic(&data.join("alerts.json"), &json!(list).to_string());
    let _ = app.emit("alerts", list);
}

pub fn list(data: &Path) -> Vec<Value> {
    load(data)
}

pub async fn add(app: &AppHandle, data: &Path, item: &Value, kind: &str, target: f64, rank: Option<i64>) -> Result<Value, String> {
    let slug = item["slug"].as_str().ok_or("Item fehlt")?;
    let max_rank = item["maxRank"].as_i64().filter(|&r| r > 0);
    let id = format!("{:x}{:04x}", now_ms(), (now_ms() as u64).wrapping_mul(2654435761) & 0xffff);
    let a = json!({
        "id": id,
        "slug": slug,
        "name": item["name"],
        "thumb": item.get("thumb").cloned().unwrap_or(Value::Null),
        "rank": max_rank.map(|_| rank.unwrap_or(0)),
        "maxRank": max_rank,
        "kind": if kind == "wtb" { "wtb" } else { "wts" },
        "target": target.round().max(1.0) as i64,
        "enabled": true,
        "created": now_ms(),
        "price": null, "checked": null, "triggered": false, "error": null,
    });
    {
        let _g = LOCK.lock().await;
        let mut l = load(data);
        l.insert(0, a.clone());
        save(app, data, &l);
    }
    // Gleich einmal prüfen
    let (app2, data2, id2) = (app.clone(), data.to_path_buf(), id.clone());
    tauri::async_runtime::spawn(async move { check(&app2, &data2, Some(vec![id2])).await });
    Ok(a)
}

pub async fn remove(app: &AppHandle, data: &Path, id: &str) {
    let _g = LOCK.lock().await;
    let mut l = load(data);
    l.retain(|a| a["id"] != id);
    save(app, data, &l);
}

/// Wieder einschalten = neu scharf (sonst bliebe ein alter Treffer stumm).
pub async fn toggle(app: &AppHandle, data: &Path, id: &str) {
    let _g = LOCK.lock().await;
    let mut l = load(data);
    if let Some(a) = l.iter_mut().find(|a| a["id"] == id) {
        let on = a["enabled"].as_bool().unwrap_or(true);
        a["enabled"] = json!(!on);
        if !on {
            a["triggered"] = json!(false);
        }
    }
    save(app, data, &l);
}

fn rank_text(a: &Value, en: bool) -> String {
    match (a["rank"].as_i64(), a["maxRank"].as_i64()) {
        (Some(r), Some(m)) if r == m => if en { format!("Max (rank {r})") } else { format!("Max (Rang {r})") },
        (Some(r), _) => if en { format!("Rank {r}") } else { format!("Rang {r}") },
        _ => String::new(),
    }
}

/// Prüft aktive Alarme (ids = nur diese). Jedes Item/Rang wird nur einmal abgefragt.
pub async fn check(app: &AppHandle, data: &Path, ids: Option<Vec<String>>) {
    let _run = RUN.lock().await;
    let todo: Vec<Value> = load(data)
        .into_iter()
        .filter(|a| a["enabled"].as_bool().unwrap_or(true))
        .filter(|a| ids.as_ref().map_or(true, |ids| ids.iter().any(|i| a["id"] == i.as_str())))
        .collect();
    let settings = app.state::<AppState>().settings.get();
    let en = settings["language"] == "en";
    let mut prices: HashMap<String, Result<Value, String>> = HashMap::new();
    for a in todo {
        let slug = a["slug"].as_str().unwrap_or("").to_string();
        let rank = a["rank"].as_i64().unwrap_or(0).max(0) as u32;
        let key = format!("{slug}@{rank}");
        if !prices.contains_key(&key) {
            let p = crate::net::price(data, &slug, rank, true).await;
            prices.insert(key.clone(), p);
        }
        // Während der Abfrage kann sich die Liste geändert haben: frisch laden und nur diesen Eintrag ändern
        let _g = LOCK.lock().await;
        let mut l = load(data);
        let Some(cur) = l.iter_mut().find(|x| x["id"] == a["id"]) else { continue };
        if !cur["enabled"].as_bool().unwrap_or(true) {
            continue;
        }
        match &prices[&key] {
            Err(e) => {
                cur["error"] = json!(e);
                cur["checked"] = json!(now_ms());
            }
            Ok(p) => {
                let wtb = cur["kind"] == "wtb";
                let value = if wtb { p["wtb"].as_i64() } else { p["wts"].as_i64() };
                let target = cur["target"].as_i64().unwrap_or(0);
                let hit = value.is_some_and(|v| if wtb { v >= target } else { v <= target });
                let was = cur["triggered"].as_bool().unwrap_or(false);
                if hit && !was {
                    cur["triggered"] = json!(true);
                    if settings["notify"].as_bool().unwrap_or(true) && settings["notifyPriceAlerts"].as_bool().unwrap_or(true) {
                        let name = cur["name"].as_str().unwrap_or("");
                        let rt = rank_text(cur, en);
                        let rank = if rt.is_empty() { String::new() } else { format!(" · {rt}") };
                        let (what, alarm) = match (wtb, en) {
                            (true, true) => ("Buy order", "Price alert"),
                            (false, true) => ("Sell offer", "Price alert"),
                            (true, false) => ("Kaufgebot", "Preis-Alarm"),
                            (false, false) => ("Verkaufsangebot", "Preis-Alarm"),
                        };
                        let op = if wtb { "≥" } else { "≤" };
                        crate::notify::send_kind(app, "priceAlert", &format!("{alarm}: {name}{rank}"), &format!("{name}: {what} {}p {op} {target}p", value.unwrap_or(0)));
                    }
                } else if !hit && value.is_some() {
                    cur["triggered"] = json!(false); // wieder über/unter der Grenze -> neu scharf
                }
                cur["price"] = json!(value);
                cur["checked"] = json!(now_ms());
                cur["error"] = Value::Null;
            }
        }
        save(app, data, &l);
    }
}

/// Hintergrund: 5 s nach dem Start, dann alle X Minuten (Einstellung, 5–30).
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        loop {
            let st = app.state::<AppState>();
            let s = st.settings.get();
            if s["notifyPriceAlerts"].as_bool().unwrap_or(true) && !load(&st.data).is_empty() {
                check(&app, &st.data, None).await;
            }
            let minutes = s["priceAlertMinutes"].as_u64().unwrap_or(10).clamp(5, 30);
            tokio::time::sleep(std::time::Duration::from_secs(minutes * 60)).await;
        }
    });
}

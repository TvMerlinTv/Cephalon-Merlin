//! Windows-Benachrichtigungen für Zyklus-Wechsel, Baro, neue Sortie und Archon-Jagd.
//! Neu gegenüber der Electron-Version: läuft im Rust-Teil, unabhängig davon, welche Seite offen ist.
use crate::net::now_ms;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const PLACES: [(&str, &str); 4] = [("earth", "Erde"), ("cetus", "Cetus"), ("vallis", "Orb Vallis"), ("cambion", "Cambion Drift")];

static SENT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn state_name(s: &str, en: bool) -> &'static str {
    match (s, en) {
        ("day", false) => "Tag",
        ("night", false) => "Nacht",
        ("warm", false) => "Warm",
        ("cold", false) => "Kalt",
        ("day", true) => "Day",
        ("night", true) => "Night",
        ("warm", true) => "Warm",
        ("cold", true) => "Cold",
        ("fass", _) => "Fass",
        ("vome", _) => "Vome",
        _ => "?",
    }
}
fn flip(s: &str) -> &'static str {
    match s {
        "day" => "night",
        "night" => "day",
        "warm" => "cold",
        "cold" => "warm",
        "fass" => "vome",
        _ => "fass",
    }
}

fn iso_ms(v: &Value) -> i64 {
    // "2026-11-08T03:17:13.441Z" -> ms (nur für unsere eigenen ISO-Zeiten)
    let s = v.as_str().unwrap_or("");
    let p = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, mo, d) = (p(0, 4), p(5, 7), p(8, 10));
    let (h, mi, se, ms) = (p(11, 13), p(14, 16), p(17, 19), p(20, 23));
    // Tage seit 1970 (Hinnant, umgekehrt)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    ((days * 86_400 + h * 3600 + mi * 60 + se) * 1000) + ms
}

/// Benachrichtigung + (falls eingeschaltet) Discord-Webhook für diese Art (priceAlert | foundry | baro | world).
pub fn send_kind(app: &AppHandle, kind: &str, title: &str, body: &str) {
    send(app, title, body);
    crate::discord::hook(app, kind, title, body);
}

pub fn send(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        crate::logger::warn("notify", e.to_string());
    }
}

fn load_state(data: &Path) -> Value {
    std::fs::read_to_string(data.join("notify-state.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}))
}

/// Prüft, ob etwas gemeldet werden muss. Wird alle 15 s mit dem letzten Weltstatus aufgerufen.
pub fn check(app: &AppHandle, data: &Path, s: &Value, world: &Value) {
    if !s["notify"].as_bool().unwrap_or(true) {
        return;
    }
    let en = s["language"] == "en";
    let now = now_ms();
    let mut sent = SENT.lock().unwrap_or_else(|e| e.into_inner());
    let sent = sent.get_or_insert_with(HashSet::new);

    let minutes = s["notifyMinutes"].as_i64().unwrap_or(3);
    for (key, place) in PLACES {
        let c = &world[key];
        if !s["notifyCycles"][key].as_bool().unwrap_or(false) || c["expiry"].is_null() {
            continue;
        }
        let left = iso_ms(&c["expiry"]) - now;
        let id = format!("{key}|{}", c["expiry"]);
        if left > 0 && left <= minutes * 60_000 + 1000 && sent.insert(id) {
            let cur = c["state"].as_str().unwrap_or("");
            let mins = ((left as f64) / 60_000.0).round().max(1.0) as i64;
            let (title, body) = if en {
                (format!("{place}: {} in {mins} min", state_name(flip(cur), true)), format!("Now: {}", state_name(cur, true)))
            } else {
                (format!("{place}: {} in {mins} Min.", state_name(flip(cur), false)), format!("Gerade: {}", state_name(cur, false)))
            };
            send_kind(app, "world", &title, &body);
        }
    }

    let mut st = load_state(data);
    let mut changed = false;
    // Baro: nur kurz nach der Ankunft melden und pro Besuch einmal (auch über Neustarts hinweg)
    let baro = &world["baro"];
    if s["notifyBaro"].as_bool().unwrap_or(true) && !baro.is_null() {
        let since = now - iso_ms(&baro["activation"]);
        if (0..3_600_000).contains(&since) && st["baro"] != baro["activation"] {
            st["baro"] = baro["activation"].clone();
            changed = true;
            let loc = baro["location"].as_str().unwrap_or("Relay");
            if en {
                send_kind(app, "baro", "Baro Ki'Teer has arrived", &format!("{loc} – stays for 48 hours"));
            } else {
                send_kind(app, "baro", "Baro Ki'Teer ist da", &format!("{loc} – bleibt 48 Stunden"));
            }
        }
    }
    // Neue Sortie / Archon-Jagd: in der ersten Stunde einmal melden
    for (kind, setting, de, en_t) in [
        ("sortie", "notifySortie", "Neue Sortie", "New sortie"),
        ("archon", "notifyArchon", "Neue Archon-Jagd", "New archon hunt"),
    ] {
        let r = &world[kind];
        if !s[setting].as_bool().unwrap_or(false) || r.is_null() || st[kind] == r["id"] {
            continue;
        }
        let since = now - iso_ms(&r["activation"]);
        if !(0..=3_600_000).contains(&since) {
            continue;
        }
        st[kind] = r["id"].clone();
        changed = true;
        let body = r["missions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|m| format!("{} ({})", m["missionType"].as_str().unwrap_or(""), m["node"].as_str().unwrap_or("")))
            .collect::<Vec<_>>()
            .join(" · ");
        send_kind(app, "world", &format!("{}: {}", if en { en_t } else { de }, r["boss"].as_str().unwrap_or("")), &body);
    }
    if changed {
        let _ = std::fs::write(data.join("notify-state.json"), st.to_string());
    }
}

/// Meldet jeden fertigen Foundry-Bauauftrag genau einmal (gemerkt in foundry.json, wie bisher).
pub fn check_foundry(app: &AppHandle, data: &Path, s: &Value) {
    if !s["notify"].as_bool().unwrap_or(true) || !s["notifyFoundry"].as_bool().unwrap_or(true) {
        return;
    }
    let list = crate::game::LAST_FOUNDRY.lock().map(|l| l.clone()).unwrap_or_default();
    let now = now_ms();
    let done: Vec<&Value> = list.iter().filter(|b| b["completesAt"].as_i64().is_some_and(|t| t <= now)).collect();
    if done.is_empty() {
        return;
    }
    let file = data.join("foundry.json");
    let mut sent: serde_json::Map<String, Value> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let en = s["language"] == "en";
    let mut changed = false;
    for b in done {
        let at = b["completesAt"].as_i64().unwrap_or(0);
        let key = format!("{}|{at}", b["recipe"].as_str().unwrap_or(""));
        if sent.contains_key(&key) {
            continue;
        }
        sent.insert(key, json!(at));
        changed = true;
        let name = b["name"].as_str().unwrap_or("?");
        if en {
            send_kind(app, "foundry", &format!("Foundry: {name} is ready"), "Ready to claim in the Foundry.");
        } else {
            send_kind(app, "foundry", &format!("Foundry: {name} ist fertig"), "Kann in der Foundry abgeholt werden.");
        }
    }
    if changed {
        // Gemeldete Aufträge 30 Tage merken
        sent.retain(|_, v| v.as_i64().unwrap_or(0) >= now - 30 * 24 * 3_600_000);
        let _ = crate::paths::write_atomic(&file, &Value::Object(sent).to_string());
    }
}

/// Damit Windows die Benachrichtigungen einer nicht installierten .exe mit Namen und Icon zeigt,
/// wird die App-ID einmal unter HKCU\Software\Classes\AppUserModelId registriert (nur der eigene Eintrag).
#[cfg(windows)]
pub fn register_app_id(identifier: &str, icon: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let key = format!(r"HKCU\Software\Classes\AppUserModelId\{identifier}");
    for (name, value) in [("DisplayName", "Cephalon Merlin".to_string()), ("IconUri", icon.display().to_string())] {
        let _ = std::process::Command::new("reg.exe")
            .args(["add", &key, "/v", name, "/t", "REG_SZ", "/d", &value, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn iso_roundtrip() {
        assert_eq!(super::iso_ms(&serde_json::json!("2018-11-10T08:13:48.000Z")), 1_541_837_628_000);
        assert_eq!(super::iso_ms(&serde_json::json!("1970-01-01T00:00:01.500Z")), 1500);
    }
}

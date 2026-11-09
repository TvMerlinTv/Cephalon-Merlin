//! Weltstatus direkt vom offiziellen Warframe-Weltstatus (api.warframe.com): Spalten, Void-Stürme,
//! Baro, Zyklen von Erde/Cetus/Vallis/Cambion, Sortie, Archon-Jagd, Nightwave.
//! Gleiches Ausgabeformat wie electron/world.cjs. Neu: Der Rust-Teil lädt ihn jede Minute selbst
//! und schickt ihn an alle Fenster ("world") – die Oberfläche muss nichts mehr abfragen.
use crate::net::{client, err_text, now_ms};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Mutex as StdMutex;
use tokio::sync::Mutex;

const WORLDSTATE: &str = "https://api.warframe.com/cdn/worldState.php";
// Namen für Knoten ("SolNode84" -> "Nereid (Neptune)") und Missionstypen (WFCD, Open Source)
const NAMES: &str = "https://cdn.jsdelivr.net/npm/warframe-worldstate-data@3.18.1/dist/data/";
const NAMES_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

const TIERS: [(&str, &str, u8); 6] = [
    ("VoidT1", "Lith", 1),
    ("VoidT2", "Meso", 2),
    ("VoidT3", "Neo", 3),
    ("VoidT4", "Axi", 4),
    ("VoidT5", "Requiem", 5),
    ("VoidT6", "Omnia", 6),
];

static NAMES_CACHE: Mutex<Option<Value>> = Mutex::const_new(None);
static LATEST: StdMutex<Option<Value>> = StdMutex::new(None);

pub fn latest() -> Option<Value> {
    LATEST.lock().ok()?.clone()
}

async fn get_json(url: &str) -> Result<Value, String> {
    // Ein zweiter Versuch, falls der Server eine ruhende Verbindung geschlossen hat ("error sending request")
    let res = match client().get(url).send().await {
        Ok(r) => r,
        Err(e) if e.is_request() || e.is_connect() => {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            client().get(url).send().await.map_err(err_text)?
        }
        Err(e) => return Err(err_text(e)),
    };
    if !res.status().is_success() {
        return Err(format!("HTTP {} für {url}", res.status().as_u16()));
    }
    res.json().await.map_err(err_text)
}

async fn names(data: &Path) -> Value {
    let mut slot = NAMES_CACHE.lock().await;
    let file = data.join("cache").join("worldstate-names.json");
    if slot.is_none() {
        // Auch den Cache der Electron-Version (im Datenordner) akzeptieren
        let read = |p: &Path| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        *slot = read(&file).or_else(|| read(&data.join("worldstate-names.json")));
    }
    let fresh = slot.as_ref().is_some_and(|n| {
        now_ms() - n["ts"].as_i64().unwrap_or(0) < NAMES_TTL_MS && n.get("sortie").is_some() && n.get("challenges").is_some()
    });
    if fresh {
        return slot.clone().unwrap_or_default();
    }
    let fetched = async {
        let urls = ["solNodes", "missionTypes", "sortieData", "languages"].map(|n| format!("{NAMES}{n}.json"));
        let (nodes, missions, sortie, langs) =
            tokio::try_join!(get_json(&urls[0]), get_json(&urls[1]), get_json(&urls[2]), get_json(&urls[3]))?;
        // Nightwave: nur die Herausforderungen aus languages.json (sonst ~700 KB)
        let challenges: Map<String, Value> = langs
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(k, _)| k.to_lowercase().contains("/challenges/seasons/"))
            .map(|(k, v)| (k.to_lowercase(), v.clone()))
            .collect();
        Ok::<Value, String>(json!({
            "ts": now_ms(),
            "nodes": nodes,
            "missions": missions,
            "sortie": { "bosses": sortie["bosses"], "modifiers": sortie["modifierTypes"], "descriptions": sortie["modifierDescriptions"] },
            "challenges": challenges,
        }))
    }
    .await;
    match fetched {
        Ok(n) => {
            let _ = std::fs::create_dir_all(file.parent().unwrap_or(data));
            let _ = crate::paths::write_atomic(&file, &n.to_string());
            *slot = Some(n.clone());
            n
        }
        // Offline: alten Cache nehmen, sonst ohne Namen (dann stehen die Roh-IDs da)
        Err(e) => {
            crate::logger::warn("world", format!("Namen nicht geladen: {e}"));
            slot.clone().unwrap_or_else(|| json!({ "nodes": {}, "missions": {}, "sortie": {}, "challenges": {} }))
        }
    }
}

fn ms(d: &Value) -> i64 {
    let v = &d["$date"]["$numberLong"];
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()).unwrap_or(0)
}

/// ISO-Zeit (UTC) für die Oberfläche.
fn iso(t: i64) -> String {
    let secs = t.div_euclid(1000);
    let millis = t.rem_euclid(1000);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn cycle(state: &str, from: i64, to: i64) -> Value {
    json!({ "state": state, "activation": iso(from), "expiry": iso(to) })
}

// Erde: 4 Std. Tag, 4 Std. Nacht, Wechsel zu jeder vollen 4. UTC-Stunde (00:00 beginnt ein Tag)
fn earth_cycle(now: i64) -> Value {
    let len = 4 * 3_600_000;
    let slot = now.div_euclid(len);
    cycle(if slot % 2 == 0 { "day" } else { "night" }, slot * len, (slot + 1) * len)
}

// Cetus: 150 Min. (100 Tag + 50 Nacht); das Cetus-Kopfgeld endet genau mit der Nacht.
fn cetus_cycle(bounty_end: i64, now: i64) -> Value {
    let len = 150 * 60_000;
    let night = 50 * 60_000;
    let mut end = if bounty_end > 0 { bounty_end } else { now };
    while end <= now {
        end += len;
    }
    while end - len > now {
        end -= len;
    }
    let night_start = end - night;
    if now < night_start {
        cycle("day", end - len, night_start)
    } else {
        cycle("night", night_start, end)
    }
}

// Orb Vallis: 1600 s (400 s warm, 1200 s kalt), gleichbleibend seit dem 10.11.2018 08:13:48 UTC
fn vallis_cycle(now: i64) -> Value {
    let start: i64 = 1_541_837_628_000;
    let (lp, warm) = (1_600_000, 400_000);
    let loop_start = now - (now - start).rem_euclid(lp);
    if now - loop_start < warm {
        cycle("warm", loop_start, loop_start + warm)
    } else {
        cycle("cold", loop_start + warm, loop_start + lp)
    }
}

/// "SORTIE_MODIFIER_LOW_ENERGY" -> "Low Energy" (falls kein Name bekannt)
fn humanize(s: &str, prefix: &str) -> String {
    let s = s.strip_prefix(prefix).unwrap_or(s).replace('_', " ");
    let mut spaced = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if prev_lower && (c.is_ascii_uppercase() || c.is_ascii_digit()) {
            spaced.push(' ');
        }
        prev_lower = c.is_ascii_lowercase();
        spaced.push(c);
    }
    spaced
        .to_lowercase()
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn oid(v: &Value, fallback: impl FnOnce() -> String) -> String {
    v["_id"]["$oid"].as_str().map(String::from).unwrap_or_else(fallback)
}

pub fn parse(ws: &Value, names: &Value, now: i64) -> Value {
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let node = |id: &Value| names["nodes"][id.as_str().unwrap_or("")]["value"].as_str().map(String::from).unwrap_or_else(|| s(id));
    let node_type = |id: &Value| s(&names["nodes"][id.as_str().unwrap_or("")]["type"]);
    let mission = |mt: &Value, id: &Value| {
        let m = s(&names["missions"][mt.as_str().unwrap_or("")]["value"]);
        if !m.is_empty() {
            m
        } else if !node_type(id).is_empty() {
            node_type(id)
        } else {
            s(mt)
        }
    };
    let tier = |key: &Value| TIERS.iter().find(|t| Some(t.0) == key.as_str());
    let list = |key: &str| ws[key].as_array().cloned().unwrap_or_default();

    let mut fissures: Vec<Value> = list("ActiveMissions")
        .iter()
        .filter(|m| ms(&m["Expiry"]) > now)
        .filter_map(|m| {
            let t = tier(&m["Modifier"])?;
            Some(json!({
                "id": oid(m, || format!("{}{}", s(&m["Node"]), ms(&m["Activation"]))),
                "tier": t.1, "tierNum": t.2,
                "missionType": mission(&m["MissionType"], &m["Node"]),
                "node": node(&m["Node"]),
                "isHard": m["Hard"].as_bool().unwrap_or(false),
                "isStorm": false,
                "activation": iso(ms(&m["Activation"])), "expiry": iso(ms(&m["Expiry"])),
            }))
        })
        .collect();
    fissures.extend(list("VoidStorms").iter().filter(|m| ms(&m["Expiry"]) > now).filter_map(|m| {
        let t = tier(&m["ActiveMissionTier"])?;
        let nt = node_type(&m["Node"]);
        Some(json!({
            "id": oid(m, || format!("{}{}", s(&m["Node"]), ms(&m["Activation"]))),
            "tier": t.1, "tierNum": t.2,
            "missionType": if nt.is_empty() { "Railjack".to_string() } else { nt },
            "node": node(&m["Node"]),
            "isHard": false, "isStorm": true,
            "activation": iso(ms(&m["Activation"])), "expiry": iso(ms(&m["Expiry"])),
        }))
    }));

    let bounty_end = list("SyndicateMissions").iter().find(|x| x["Tag"] == "CetusSyndicate").map(|b| ms(&b["Expiry"])).unwrap_or(0);
    let cetus = cetus_cycle(bounty_end, now);
    let mut cambion = cetus.clone();
    cambion["state"] = json!(if cetus["state"] == "day" { "fass" } else { "vome" });
    let baro = list("VoidTraders").first().map(|t| {
        json!({ "activation": iso(ms(&t["Activation"])), "expiry": iso(ms(&t["Expiry"])), "location": node(&t["Node"]) })
    });

    let bosses = &names["sortie"]["bosses"];
    let sortie = list("Sorties").iter().find(|x| ms(&x["Expiry"]) > now).map(|x| {
        let boss = &bosses[x["Boss"].as_str().unwrap_or("")];
        json!({
            "id": oid(x, || ms(&x["Activation"]).to_string()),
            "boss": boss["name"].as_str().map(String::from).unwrap_or_else(|| humanize(&s(&x["Boss"]), "SORTIE_BOSS_")),
            "faction": s(&boss["faction"]),
            "activation": iso(ms(&x["Activation"])), "expiry": iso(ms(&x["Expiry"])),
            "missions": x["Variants"].as_array().into_iter().flatten().map(|v| {
                let mt = s(&v["modifierType"]);
                json!({
                    "missionType": mission(&v["missionType"], &v["node"]),
                    "node": node(&v["node"]),
                    "modifier": names["sortie"]["modifiers"][&mt].as_str().map(String::from).unwrap_or_else(|| humanize(&mt, "SORTIE_MODIFIER_")),
                    "modifierDesc": s(&names["sortie"]["descriptions"][&mt]),
                })
            }).collect::<Vec<_>>(),
        })
    });
    let archon = list("LiteSorties").iter().find(|x| ms(&x["Expiry"]) > now).map(|x| {
        let b = s(&x["Boss"]);
        let shard = match b.as_str() {
            "SORTIE_BOSS_AMAR" => json!("crimson"),
            "SORTIE_BOSS_NIRA" => json!("amber"),
            "SORTIE_BOSS_BOREAL" => json!("azure"),
            _ => Value::Null,
        };
        json!({
            "id": oid(x, || ms(&x["Activation"]).to_string()),
            "boss": bosses[&b]["name"].as_str().map(String::from).unwrap_or_else(|| humanize(&b, "SORTIE_BOSS_")),
            "shard": shard,
            "activation": iso(ms(&x["Activation"])), "expiry": iso(ms(&x["Expiry"])),
            "missions": x["Missions"].as_array().into_iter().flatten().map(|m| json!({
                "missionType": mission(&m["missionType"], &m["node"]), "node": node(&m["node"]),
            })).collect::<Vec<_>>(),
        })
    });
    let n = &ws["SeasonInfo"];
    let nightwave = (ms(&n["Expiry"]) > now).then(|| {
        let challenges: Vec<Value> = n["ActiveChallenges"].as_array().into_iter().flatten().filter(|c| ms(&c["Expiry"]) > now).map(|c| {
            let ch = s(&c["Challenge"]);
            let kind = if c["Daily"].as_bool().unwrap_or(false) { "daily" } else if ch.to_lowercase().contains("weeklyhard") { "elite" } else { "weekly" };
            let tr = &names["challenges"][ch.to_lowercase()];
            let last = ch.rsplit('/').next().unwrap_or("");
            let short = ["SeasonWeeklyHardPermanent", "SeasonWeeklyHard", "SeasonWeeklyPermanent", "SeasonWeekly", "SeasonDailyPermanent", "SeasonDaily"]
                .iter().find_map(|p| last.strip_prefix(p)).unwrap_or(last);
            json!({
                "id": oid(c, || ch.clone()),
                "kind": kind,
                "title": tr["value"].as_str().map(String::from).unwrap_or_else(|| humanize(short, "")),
                "desc": s(&tr["desc"]),
                "standing": match kind { "daily" => 1000, "weekly" => 4500, _ => 7000 },
                "activation": iso(ms(&c["Activation"])), "expiry": iso(ms(&c["Expiry"])),
            })
        }).collect();
        json!({
            "season": n["Season"], "phase": n["Phase"], "tag": n["AffiliationTag"],
            "activation": iso(ms(&n["Activation"])), "expiry": iso(ms(&n["Expiry"])),
            "challenges": challenges,
        })
    });

    let time = ws["Time"].as_i64().map(|t| t * 1000).unwrap_or(now);
    json!({
        "time": iso(time),
        "earth": earth_cycle(now),
        "cetus": cetus,
        "vallis": vallis_cycle(now),
        "cambion": cambion,
        "baro": baro,
        "fissures": fissures,
        "sortie": sortie,
        "archon": archon,
        "nightwave": nightwave,
    })
}

pub async fn fetch(data: &Path) -> Result<Value, String> {
    let (ws, names) = tokio::join!(get_json(WORLDSTATE), names(data));
    let ws = ws?;
    let parsed = tauri::async_runtime::spawn_blocking(move || parse(&ws, &names, now_ms()))
        .await
        .map_err(|e| e.to_string())?;
    if let Ok(mut l) = LATEST.lock() {
        *l = Some(parsed.clone());
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_and_cycles() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_541_837_628_000), "2018-11-10T08:13:48.000Z");
        let e = earth_cycle(4 * 3_600_000 + 5);
        assert_eq!(e["state"], "night");
        assert_eq!(humanize("SORTIE_MODIFIER_LOW_ENERGY", "SORTIE_MODIFIER_"), "Low Energy");
        assert_eq!(humanize("GoingDown", ""), "Going Down");
    }
}

/// Vergleich mit der Electron-Version: CMRS_WS, CMRS_NAMES, CMRS_OUT, CMRS_NOW
#[cfg(test)]
#[test]
#[ignore]
fn parity_dump() {
    let read = |k: &str| -> Value { serde_json::from_str(&std::fs::read_to_string(std::env::var(k).unwrap()).unwrap()).unwrap() };
    let now: i64 = std::env::var("CMRS_NOW").unwrap().parse().unwrap();
    std::fs::write(std::env::var("CMRS_OUT").unwrap(), parse(&read("CMRS_WS"), &read("CMRS_NAMES"), now).to_string()).unwrap();
}

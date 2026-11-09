//! Item-Datenbanken aus WFCD/warframe-items (Open Source), 7 Tage im Datenordner zwischengespeichert:
//! - Mastery-Datenbank: alle meisterbaren Items mit Bauteilen und Fundorten
//! - Relikt-Datenbank: Inhalt und Drop-Chancen pro Veredelungsstufe
//! - Sammelpreise (warframestat.us / WFInfo): Durchschnittspreis pro Item-Name, 1 Stunde
//! Gleiche Formate wie electron/masteryDb.cjs und electron/relicDb.cjs.
use crate::net::{client, err_text, now_ms};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

const CDN: &str = "https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/";
const IMG: &str = "https://cdn.warframestat.us/img/";
const TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;
// 6: Rohstoffe mit Beschreibung und Fundorten (für das Material-Info-Fenster)
const MASTERY_VERSION: i64 = 6;
const RELIC_VERSION: i64 = 1;

async fn get_json(url: &str) -> Result<Value, String> {
    let res = client().get(url).send().await.map_err(err_text)?;
    if !res.status().is_success() {
        return Err(format!("Item-Datenbank: HTTP {} für {}", res.status().as_u16(), url.rsplit('/').next().unwrap_or(url)));
    }
    let bytes = res.bytes().await.map_err(err_text)?;
    // Große Dateien (bis ~10 MB) nicht im async-Thread parsen
    tauri::async_runtime::spawn_blocking(move || serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

fn cache_file(data: &Path, name: &str) -> PathBuf {
    let dir = data.join("cache");
    let _ = std::fs::create_dir_all(&dir);
    dir.join(name)
}

fn read_cached(file: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

/// Gemeinsamer Ablauf: Cache (Version + Alter), sonst neu bauen, offline notfalls alter Cache.
async fn cached_or_build<F, Fut>(slot: &Mutex<Option<Value>>, file: PathBuf, version: i64, force: bool, build: F) -> Result<Value, String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let mut g = slot.lock().await;
    let ok = |v: &Value| v["version"].as_i64() == Some(version) && now_ms() - v["builtAt"].as_i64().unwrap_or(0) < TTL_MS;
    if !force {
        if let Some(v) = g.as_ref().filter(|v| ok(v)) {
            return Ok(v.clone());
        }
        let f = file.clone();
        if let Some(v) = tauri::async_runtime::spawn_blocking(move || read_cached(&f)).await.ok().flatten() {
            if ok(&v) {
                *g = Some(v.clone());
                return Ok(v);
            }
        }
    }
    match build().await {
        Ok(db) => {
            let text = db.to_string();
            let _ = crate::paths::write_atomic(&file, &text);
            *g = Some(db.clone());
            Ok(db)
        }
        Err(e) => {
            crate::logger::warn("db", &e);
            if let Some(v) = g.clone().or_else(|| read_cached(&file)) {
                return Ok(v);
            }
            Err(e)
        }
    }
}

// ---------- Mastery ----------
static MASTERY: Mutex<Option<Value>> = Mutex::const_new(None);

// [Datei, Kategorie in der UI, Warframe-artig? (doppelte XP pro Rang)]
const CATEGORIES: [(&str, &str, bool); 10] = [
    ("Warframes", "Warframes", true),
    ("Primary", "Primär", false),
    ("Secondary", "Sekundär", false),
    ("Melee", "Nahkampf", false),
    ("Archwing", "Archwing", true),
    ("Arch-Gun", "Arch-Gun", false),
    ("Arch-Melee", "Arch-Melee", false),
    ("Sentinels", "Begleiter", true),
    ("Pets", "Begleiter", true),
    ("SentinelWeapons", "Begleiter-Waffen", false),
];

fn top_drops(drops: &Value) -> Vec<Value> {
    let mut list: Vec<&Value> = drops.as_array().into_iter().flatten().collect();
    list.sort_by(|a, b| {
        b["chance"].as_f64().unwrap_or(0.0).partial_cmp(&a["chance"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)
    });
    list.into_iter()
        .take(12)
        .map(|d| json!({ "location": d["location"], "chance": d.get("chance").cloned().unwrap_or(Value::Null), "rarity": d.get("rarity").cloned().unwrap_or(Value::Null) }))
        .collect()
}

/// "/Lotus/Types/Items/MiscItems/OrokinCell" -> "Orokin Cell"
fn name_from_path(id: &str) -> String {
    let last = id.rsplit('/').next().unwrap_or(id);
    let last = last.strip_suffix("Item").unwrap_or(last);
    let mut out = String::new();
    let mut prev_lower = false;
    for c in last.chars() {
        if prev_lower && c.is_ascii_uppercase() {
            out.push(' ');
        }
        prev_lower = c.is_ascii_lowercase();
        out.push(c);
    }
    out
}

fn is_part(id: &str) -> bool {
    id.contains("/Recipes/") || id.contains("/Weapons/") || id.contains("/Powersuits/")
}

fn img(name: &Value) -> Value {
    name.as_str().map(|n| json!(format!("{IMG}{n}"))).unwrap_or(Value::Null)
}

async fn build_mastery() -> Result<Value, String> {
    let urls: Vec<String> = ["Components", "Resources", "Misc"]
        .iter()
        .map(|f| f.to_string())
        .chain(CATEGORIES.iter().map(|c| c.0.to_string()))
        .map(|f| format!("{CDN}{f}.json"))
        .collect();
    let results = futures_join_all(urls.into_iter().map(|u| async move { get_json(&u).await }).collect()).await;
    let mut lists = Vec::new();
    for (i, r) in results.into_iter().enumerate() {
        // Misc.json ist optional
        lists.push(if i == 2 { r.unwrap_or_else(|_| json!([])) } else { r? });
    }
    tauri::async_runtime::spawn_blocking(move || assemble_mastery(&lists)).await.map_err(|e| e.to_string())
}

/// Mehrere Futures gleichzeitig (ohne zusätzliches Crate).
async fn futures_join_all<F: std::future::Future<Output = Result<Value, String>> + Send + 'static>(futs: Vec<F>) -> Vec<Result<Value, String>> {
    let handles: Vec<_> = futs.into_iter().map(tauri::async_runtime::spawn).collect();
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.map_err(|e| e.to_string()).and_then(|r| r));
    }
    out
}

fn assemble_mastery(lists: &[Value]) -> Value {
    let arr = |v: &Value| v.as_array().cloned().unwrap_or_default();
    let (components, resources, misc) = (&lists[0], &lists[1], &lists[2]);
    let mut comp_info: HashMap<String, Value> = HashMap::new();
    for r in arr(misc).iter().chain(arr(resources).iter()) {
        if let Some(id) = r["uniqueName"].as_str() {
            comp_info.insert(id.into(), json!({ "name": r["name"], "drops": top_drops(&r["drops"]), "description": r.get("description").cloned().unwrap_or(Value::Null), "image": img(&r["imageName"]) }));
        }
    }
    for c in arr(components) {
        if let Some(id) = c["uniqueName"].as_str() {
            comp_info.insert(id.into(), json!({ "name": c["name"], "drops": top_drops(&c["drops"]), "ducats": c.get("primeSellingPrice").cloned().unwrap_or(Value::Null), "image": img(&c["imageName"]) }));
        }
    }
    let mut items: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, (_, category, frame_like)) in CATEGORIES.iter().enumerate() {
        for it in arr(&lists[3 + i]) {
            let Some(id) = it["uniqueName"].as_str() else { continue };
            if !it["masterable"].as_bool().unwrap_or(false) || !seen.insert(id.to_string()) {
                continue;
            }
            let cap = it["maxLevelCap"].as_i64().unwrap_or(30);
            // WFCD listet manche Bauteile doppelt – zusammenfassen
            let mut merged: Vec<Value> = Vec::new();
            for c in arr(&it["components"]) {
                let cid = c["uniqueName"].as_str().unwrap_or("");
                if let Some(prev) = merged.iter_mut().find(|p| p["uniqueName"].as_str() == Some(cid)) {
                    let n = prev["itemCount"].as_i64().unwrap_or(1) + c["itemCount"].as_i64().unwrap_or(1);
                    prev["itemCount"] = json!(n);
                } else {
                    merged.push(c.clone());
                }
            }
            let comps: Vec<Value> = merged
                .iter()
                .map(|c| {
                    let cid = c["uniqueName"].as_str().unwrap_or("");
                    let info = comp_info.get(cid).cloned().unwrap_or_else(|| json!({}));
                    let name = info["name"].as_str().or_else(|| c["name"].as_str()).map(String::from).unwrap_or_else(|| name_from_path(cid));
                    let drops = if info.get("drops").is_some() { info["drops"].clone() } else { json!(top_drops(&c["drops"])) };
                    let ducats = if !info["ducats"].is_null() { info["ducats"].clone() } else { c.get("primeSellingPrice").cloned().unwrap_or(Value::Null) };
                    let image = if !info["image"].is_null() { info["image"].clone() } else { img(&c["imageName"]) };
                    json!({
                        "id": cid,
                        "kind": if is_part(cid) { "part" } else { "resource" },
                        "name": name,
                        "count": c["itemCount"].as_i64().unwrap_or(1),
                        "drops": drops,
                        "ducats": ducats,
                        "image": image,
                        "description": info.get("description").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect();
            items.push(json!({
                "id": id,
                "name": it["name"],
                "category": category,
                "masteryReq": it["masteryReq"].as_i64().unwrap_or(0),
                "maxXp": (if *frame_like { 1000 } else { 500 }) * cap * cap,
                "maxRank": cap,
                "image": img(&it["imageName"]),
                "isPrime": it["isPrime"].as_bool().unwrap_or(false),
                "vaulted": it.get("vaulted").cloned().unwrap_or(Value::Null),
                "wiki": it.get("wikiaUrl").cloned().unwrap_or(Value::Null),
                "credits": it["buildPrice"].as_i64().unwrap_or(0),
                "components": comps,
            }));
        }
    }
    items.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    // Waffen als Bauteil (Bolto für Akbolto …): Bild der Waffe selbst
    let image_by_id: HashMap<String, Value> = items.iter().map(|it| (it["id"].as_str().unwrap_or("").to_string(), it["image"].clone())).collect();
    for it in items.iter_mut() {
        if let Some(cs) = it["components"].as_array_mut() {
            for c in cs {
                if c["image"].is_null() {
                    c["image"] = image_by_id.get(c["id"].as_str().unwrap_or("")).cloned().unwrap_or(Value::Null);
                }
            }
        }
    }
    json!({ "version": MASTERY_VERSION, "builtAt": now_ms(), "items": items })
}

pub async fn mastery(data: &Path, force: bool) -> Result<Value, String> {
    cached_or_build(&MASTERY, cache_file(data, "mastery-db.json"), MASTERY_VERSION, force, build_mastery).await
}

// ---------- Relikte ----------
static RELICS: Mutex<Option<Value>> = Mutex::const_new(None);
const REFS: [(&str, &str); 4] = [("Intact", "intact"), ("Exceptional", "exceptional"), ("Flawless", "flawless"), ("Radiant", "radiant")];

fn assemble_relics(list: &Value) -> Value {
    let mut relics: Vec<Value> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for r in list.as_array().into_iter().flatten() {
        let full = r["name"].as_str().unwrap_or("");
        let Some((name, rf)) = REFS.iter().find_map(|(word, key)| full.strip_suffix(&format!(" {word}")).map(|n| (n, *key))) else { continue };
        let rewards = r["rewards"].as_array().cloned().unwrap_or_default();
        if rewards.is_empty() {
            continue;
        }
        let uid = r["uniqueName"].as_str().unwrap_or("");
        let id = ["Bronze", "Silver", "Gold", "Platinum"].iter().find_map(|s| uid.strip_suffix(s)).unwrap_or(uid).to_string();
        let i = *index.entry(id.clone()).or_insert_with(|| {
            relics.push(json!({
                "id": id,
                "name": name,
                "tier": name.split(' ').next().unwrap_or(""),
                "vaulted": r["vaulted"].as_bool().unwrap_or(false),
                "image": img(&r["imageName"]),
                "rewards": {},
            }));
            relics.len() - 1
        });
        let rw: Vec<Value> = rewards
            .iter()
            .map(|w| json!({
                "id": w["item"].get("uniqueName").cloned().unwrap_or(Value::Null),
                "name": w["item"]["name"].as_str().unwrap_or("?"),
                "slug": w["item"]["warframeMarket"].get("urlName").cloned().unwrap_or(Value::Null),
                "chance": w["chance"],
            }))
            .collect();
        relics[i]["rewards"][rf] = json!(rw);
    }
    relics.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    json!({ "version": RELIC_VERSION, "builtAt": now_ms(), "relics": relics })
}

pub async fn relics(data: &Path, force: bool) -> Result<Value, String> {
    cached_or_build(&RELICS, cache_file(data, "relic-db.json"), RELIC_VERSION, force, || async {
        let list = get_json(&format!("{CDN}Relics.json")).await?;
        tauri::async_runtime::spawn_blocking(move || assemble_relics(&list)).await.map_err(|e| e.to_string())
    })
    .await
}

// ---------- Sammelpreise (WFInfo-Quelle, stündlich) ----------
static BULK: Mutex<Option<(i64, Value)>> = Mutex::const_new(None);
const BULK_TTL_MS: i64 = 60 * 60 * 1000;

/// { "itemname in kleinbuchstaben": Durchschnittspreis }
pub async fn bulk_prices(data: &Path) -> Result<Value, String> {
    let mut g = BULK.lock().await;
    let file = cache_file(data, "bulk-prices.json");
    if g.is_none() {
        if let Some(v) = read_cached(&file) {
            *g = Some((v["ts"].as_i64().unwrap_or(0), v["prices"].clone()));
        }
    }
    if let Some((ts, p)) = g.as_ref() {
        if now_ms() - ts < BULK_TTL_MS {
            return Ok(p.clone());
        }
    }
    match get_json("https://api.warframestat.us/wfinfo/prices").await {
        Ok(list) => {
            let mut prices = Map::new();
            for p in list.as_array().into_iter().flatten() {
                let name = p["name"].as_str().unwrap_or("").to_lowercase();
                let v = p["custom_avg"].as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| p["custom_avg"].as_f64()).unwrap_or(0.0);
                prices.insert(name, json!(v));
            }
            let prices = Value::Object(prices);
            let ts = now_ms();
            let _ = crate::paths::write_atomic(&file, &json!({ "ts": ts, "prices": prices }).to_string());
            *g = Some((ts, prices.clone()));
            Ok(prices)
        }
        Err(e) => g.as_ref().map(|(_, p)| p.clone()).ok_or(e),
    }
}

/// Vergleich mit der Electron-Version: CMRS_OUT=<ordner> cargo test db::dump -- --ignored
#[cfg(test)]
#[test]
#[ignore]
fn dump() {
    let out = PathBuf::from(std::env::var("CMRS_OUT").unwrap());
    tauri::async_runtime::block_on(async {
        std::fs::write(out.join("mastery-rs.json"), build_mastery().await.unwrap().to_string()).unwrap();
        let list = get_json(&format!("{CDN}Relics.json")).await.unwrap();
        std::fs::write(out.join("relic-rs.json"), assemble_relics(&list).to_string()).unwrap();
    });
}

//! Builds von overframe.gg (öffentliche, undokumentierte REST-API unter /api/v1/).
//! Rücksichtsvoll wie in der Electron-Version: höchstens ~1 Anfrage pro Sekunde, Antworten 45 Minuten
//! zwischengespeichert (im Speicher und in <Datenordner>\cache\overframe-cache.json).
use crate::net::{client, err_text, now_ms, USER_AGENT};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const BASE: &str = "https://overframe.gg";
const TTL_MS: i64 = 45 * 60 * 1000;
const GAP: Duration = Duration::from_millis(1100);
const MAX_ENTRIES: usize = 300;

struct Cache {
    file: PathBuf,
    entries: HashMap<String, (i64, Value)>,
}
static CACHE: Mutex<Option<Cache>> = Mutex::const_new(None);
static LAST_SENT: Mutex<Option<Instant>> = Mutex::const_new(None);

fn load(data: &Path) -> Cache {
    let dir = data.join("cache");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("overframe-cache.json");
    let mut entries = HashMap::new();
    if let Some(Value::Object(m)) = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        for (k, v) in m {
            let ts = v["ts"].as_i64().unwrap_or(0);
            if now_ms() - ts < TTL_MS {
                entries.insert(k, (ts, v["data"].clone()));
            }
        }
    }
    Cache { file, entries }
}

fn save(c: &Cache) {
    let mut list: Vec<_> = c.entries.iter().filter(|(_, (ts, _))| now_ms() - ts < TTL_MS).collect();
    list.sort_by_key(|(_, (ts, _))| -*ts);
    let m: Map<String, Value> = list
        .into_iter()
        .take(MAX_ENTRIES)
        .map(|(k, (ts, d))| (k.clone(), serde_json::json!({ "ts": ts, "data": d })))
        .collect();
    let _ = crate::paths::write_atomic(&c.file, &Value::Object(m).to_string());
}

/// GET auf overframe.gg/api/v1/… (nur dieser Pfad ist erlaubt).
pub async fn get(data: &Path, path: &str) -> Result<Value, String> {
    if !path.starts_with("/api/v1/") || path.contains("..") || path.contains('#') {
        return Err("Ungültige API-Anfrage".into());
    }
    let hit = {
        let mut g = CACHE.lock().await;
        let c = g.get_or_insert_with(|| load(data));
        c.entries.get(path).cloned()
    };
    if let Some((ts, v)) = &hit {
        if now_ms() - ts < TTL_MS {
            return Ok(v.clone());
        }
    }
    let result = async {
        // Anfragen nacheinander mit Mindestabstand (der Mutex reiht sie ein)
        let mut last = LAST_SENT.lock().await;
        if let Some(l) = *last {
            let wait = (l + GAP).saturating_duration_since(Instant::now());
            tokio::time::sleep(wait).await;
        }
        *last = Some(Instant::now());
        let res = client()
            .get(format!("{BASE}{path}"))
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(err_text)?;
        drop(last);
        let pathname = path.split('?').next().unwrap_or(path);
        if !res.status().is_success() {
            return Err(format!("HTTP {} für {pathname}", res.status().as_u16()));
        }
        let json = res.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|t| t.contains("json"));
        // Cloudflare-Prüfseite statt JSON
        if !json {
            return Err(format!("HTTP 403 für {pathname} (Cloudflare)"));
        }
        res.json::<Value>().await.map_err(err_text)
    }
    .await;
    match result {
        Ok(v) => {
            let mut g = CACHE.lock().await;
            if let Some(c) = g.as_mut() {
                c.entries.insert(path.to_string(), (now_ms(), v.clone()));
                save(c);
            }
            Ok(v)
        }
        // Lieber veraltet als gar nichts
        Err(e) => hit.map(|(_, v)| v).ok_or(e),
    }
}

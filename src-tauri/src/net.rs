//! HTTP für alle Module: ein gemeinsamer Client und – neu gegenüber der Electron-Version –
//! EINE Warteschlange für warframe.market im Backend. Alle Seiten, Fenster und Hintergrund-
//! aufgaben (Preis-Alarme, Overlay …) teilen sich damit Abstand, Minutenlimit und 429-Pause.
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

pub const USER_AGENT: &str = concat!("CephalonMerlin/", env!("CARGO_PKG_VERSION"), " (+https://github.com/TvMerlinTv/Cephalon-Merlin)");
const MARKET: &str = "https://api.warframe.market";
pub const MARKET_ASSETS: &str = "https://warframe.market/static/assets/";

pub fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("HTTP-Client")
    })
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Fehlertext ohne URL (die URL kann bei manchen Anfragen Geheimnisse enthalten).
pub fn err_text(e: reqwest::Error) -> String {
    let e = e.without_url();
    if e.is_timeout() {
        "Zeitüberschreitung – Server antwortet nicht.".into()
    } else if e.is_connect() {
        "Keine Verbindung – bist du online?".into()
    } else {
        e.to_string()
    }
}

// ---------- Warteschlange ----------
// v2 erlaubt ca. 3 Anfragen pro Sekunde. Riven-Auktionen (v1) sind viel strenger:
// Cloudflare sperrt nach ca. 10 Anfragen pro Minute für bis zu 60 s (429 mit Retry-After).
struct LaneState {
    last: Option<Instant>,
    sent: VecDeque<Instant>,
    pause_until: Option<Instant>,
}
struct Lane {
    gap: Duration,
    max: usize,
    window: Duration,
    state: Mutex<LaneState>,
}
impl Lane {
    const fn new(gap_ms: u64, max: usize, window_ms: u64) -> Self {
        Lane {
            gap: Duration::from_millis(gap_ms),
            max,
            window: Duration::from_millis(window_ms),
            state: Mutex::const_new(LaneState { last: None, sent: VecDeque::new(), pause_until: None }),
        }
    }
    /// Wartet, bis die Spur senden darf. Der Mutex ist fair (FIFO) – Anfragen laufen in Reihenfolge.
    /// Gibt false zurück, wenn die Anfrage vorher abgebrochen wurde (dann zählt sie nicht gegen das Limit).
    async fn take_slot(&self, cancelled: &(dyn Fn() -> bool + Send + Sync)) -> bool {
        let mut s = self.state.lock().await;
        loop {
            if cancelled() {
                return false;
            }
            let now = Instant::now();
            while s.sent.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
                s.sent.pop_front();
            }
            let mut until = now;
            if let Some(p) = s.pause_until {
                until = until.max(p);
            }
            if let Some(l) = s.last {
                until = until.max(l + self.gap);
            }
            if s.sent.len() >= self.max {
                until = until.max(s.sent[0] + self.window);
            }
            if until <= now {
                s.last = Some(now);
                if self.max != usize::MAX {
                    s.sent.push_back(now);
                }
                return true;
            }
            tokio::time::sleep(until - now).await;
        }
    }
    async fn pause(&self, d: Duration) {
        let mut s = self.state.lock().await;
        let until = Instant::now() + d;
        s.pause_until = Some(s.pause_until.map_or(until, |p| p.max(until)));
    }
}

static MARKET_LANE: Lane = Lane::new(380, usize::MAX, 0);
static AUCTION_LANE: Lane = Lane::new(1500, 8, 60_000);

const MAX_RETRIES: u32 = 3;
const MAX_SILENT_WAIT: Duration = Duration::from_secs(8);

/// Fehler einer Markt-Anfrage. `retry_at` (ms seit 1970) gesetzt, wenn der Server nur ausgelastet ist.
#[derive(Debug)]
pub struct MarketError {
    pub message: String,
    pub retry_at: Option<i64>,
}
impl From<MarketError> for String {
    fn from(e: MarketError) -> String {
        match e.retry_at {
            Some(at) => format!("{} (retryAt {at})", e.message),
            None => e.message,
        }
    }
}

/// GET auf warframe.market über die passende Spur, mit Backoff bei 429/5xx (1 s, 2 s, 4 s bzw. Retry-After).
pub async fn market_get(path: &str) -> Result<Value, MarketError> {
    market_get_ex(path, "en", &|| false).await
}

/// Wie market_get, mit Sprache (Language-Header) und Abbruch-Prüfung vor dem Senden.
pub async fn market_get_ex(path: &str, language: &str, cancelled: &(dyn Fn() -> bool + Send + Sync)) -> Result<Value, MarketError> {
    let lane = if path.starts_with("/v1/auctions") { &AUCTION_LANE } else { &MARKET_LANE };
    let url = format!("{MARKET}{path}");
    let mut attempt = 0;
    loop {
        if !lane.take_slot(cancelled).await {
            return Err(MarketError { message: "Abgebrochen".into(), retry_at: None });
        }
        let res = client()
            .get(&url)
            .header("Accept", "application/json")
            .header("Language", if language == "de" { "de" } else { "en" })
            .header("Platform", "pc")
            .send()
            .await
            .map_err(|e| MarketError { message: err_text(e), retry_at: None })?;
        let status = res.status().as_u16();
        if res.status().is_success() {
            return res.json().await.map_err(|e| MarketError { message: err_text(e), retry_at: None });
        }
        let busy = status == 429 || (500..600).contains(&status);
        let message = format!("HTTP {status} für {}", path.split('?').next().unwrap_or(path));
        if !busy {
            return Err(MarketError { message, retry_at: None });
        }
        let retry_after = res
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .map(Duration::from_secs);
        let delay = retry_after.unwrap_or_default().max(Duration::from_secs(1 << attempt));
        // Bei 429 pausiert die ganze Spur, sonst würden die nächsten Anfragen die Sperre verlängern
        if status == 429 {
            lane.pause(delay).await;
        }
        if attempt >= MAX_RETRIES || delay > MAX_SILENT_WAIT {
            return Err(MarketError { message, retry_at: Some(now_ms() + delay.as_millis() as i64) });
        }
        if status != 429 {
            tokio::time::sleep(delay).await;
        }
        attempt += 1;
    }
}

// ---------- Item-Liste (24 h im Datenordner zwischengespeichert) ----------
const ITEMS_TTL_MS: i64 = 24 * 60 * 60 * 1000;
static ITEMS: Mutex<Option<(i64, Value)>> = Mutex::const_new(None);

fn cache_dir(data: &Path) -> PathBuf {
    let d = data.join("cache");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn normalize_item(i: &Value) -> Value {
    let en = &i["i18n"]["en"];
    json!({
        "id": i["id"],
        "slug": i["slug"],
        "gameRef": i.get("gameRef").cloned().unwrap_or(Value::Null),
        "name": en.get("name").cloned().unwrap_or_else(|| i["slug"].clone()),
        "thumb": en.get("thumb").and_then(Value::as_str).map(|t| format!("{MARKET_ASSETS}{t}")),
        "tags": i.get("tags").cloned().unwrap_or_else(|| json!([])),
        "ducats": i.get("ducats").cloned().unwrap_or(Value::Null),
        "vaulted": i.get("vaulted").cloned().unwrap_or(Value::Null),
        "maxRank": i.get("maxRank").cloned().unwrap_or(Value::Null),
    })
}

pub async fn items(data: &Path, force: bool) -> Result<Value, String> {
    let mut slot = ITEMS.lock().await;
    let file = cache_dir(data).join("market-items.json");
    if slot.is_none() {
        if let Some(v) = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
            *slot = Some((v["ts"].as_i64().unwrap_or(0), v["items"].clone()));
        }
    }
    if let Some((ts, list)) = slot.as_ref() {
        if !force && now_ms() - ts < ITEMS_TTL_MS {
            return Ok(list.clone());
        }
    }
    match market_get("/v2/items").await {
        Ok(r) => {
            let mut list: Vec<Value> = r["data"].as_array().into_iter().flatten().map(normalize_item).collect();
            list.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
            let list = Value::Array(list);
            let ts = now_ms();
            let _ = crate::paths::write_atomic(&file, &json!({ "ts": ts, "items": list }).to_string());
            *slot = Some((ts, list.clone()));
            Ok(list)
        }
        // Offline o. Ä.: alte Liste weiter benutzen
        Err(e) => slot.as_ref().map(|(_, l)| l.clone()).ok_or_else(|| e.into()),
    }
}

// ---------- Preise (15 min, im Datenordner gemerkt) ----------
const PRICE_TTL_MS: i64 = 15 * 60 * 1000;
static PRICES: StdMutex<Option<HashMap<String, Value>>> = StdMutex::new(None);
static PRICES_DIRTY: AtomicBool = AtomicBool::new(false);
static PENDING: Mutex<()> = Mutex::const_new(());

fn price_key(slug: &str, rank: u32) -> String {
    if rank > 0 { format!("{slug}@{rank}") } else { slug.to_string() }
}

fn prices_file(data: &Path) -> PathBuf {
    cache_dir(data).join("prices.json")
}

fn with_prices<R>(data: &Path, f: impl FnOnce(&mut HashMap<String, Value>) -> R) -> R {
    let mut g = PRICES.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(|| {
        std::fs::read_to_string(prices_file(data)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    });
    f(map)
}

/// Alle gemerkten Preise (für die erste Anzeige ohne Netz).
pub fn cached_prices(data: &Path) -> Value {
    with_prices(data, |m| json!(m))
}

/// { wts, wtb, ts } – günstigstes Verkaufs- und höchstes Kaufangebot (nur Spieler online/ingame).
pub async fn price(data: &Path, slug: &str, rank: u32, force: bool) -> Result<Value, String> {
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Ungültiger Item-Name".into());
    }
    let key = price_key(slug, rank);
    let fresh = |m: &mut HashMap<String, Value>| {
        m.get(&key).filter(|p| now_ms() - p["ts"].as_i64().unwrap_or(0) < PRICE_TTL_MS).cloned()
    };
    if !force {
        if let Some(p) = with_prices(data, fresh) {
            return Ok(p);
        }
    }
    // Gleichzeitige Anfragen für dasselbe Item: nach dem Warten nochmal in den Cache schauen
    let _g = PENDING.lock().await;
    if !force {
        if let Some(p) = with_prices(data, fresh) {
            return Ok(p);
        }
    }
    drop(_g);
    let q = if rank > 0 { format!("?rank={rank}") } else { String::new() };
    let r = market_get(&format!("/v2/orders/item/{slug}/top{q}")).await?;
    let plat = |side: &str| -> Vec<i64> {
        r["data"][side].as_array().into_iter().flatten().filter_map(|o| o["platinum"].as_i64()).collect()
    };
    let p = json!({ "wts": plat("sell").into_iter().min(), "wtb": plat("buy").into_iter().max(), "ts": now_ms() });
    with_prices(data, |m| m.insert(key, p.clone()));
    PRICES_DIRTY.store(true, Ordering::Relaxed);
    Ok(p)
}

/// Schreibt geänderte Preise alle 10 s in den Datenordner (statt bei jeder Anfrage).
pub fn start_price_saver(data: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            save_prices(&data);
        }
    });
}

pub fn save_prices(data: &Path) {
    if !PRICES_DIRTY.swap(false, Ordering::Relaxed) {
        return;
    }
    let text = with_prices(data, |m| {
        // Sehr alte Einträge (> 7 Tage) fallen weg
        let cutoff = now_ms() - 7 * 24 * 60 * 60 * 1000;
        m.retain(|_, p| p["ts"].as_i64().unwrap_or(0) > cutoff);
        serde_json::to_string(&Map::from_iter(m.iter().map(|(k, v)| (k.clone(), v.clone())))).unwrap_or_default()
    });
    let _ = crate::paths::write_atomic(&prices_file(data), &text);
}

// ---------- Rivens: Waffen/Stats (24 h) und Auktionen (15 min) ----------
static RIVEN_META: Mutex<Option<(i64, String, Value)>> = Mutex::const_new(None);
const RIVEN_META_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// Riven-Waffen (mit Disposition) und -Stats von warframe.market, in der gewünschten Sprache.
pub async fn riven_meta(data: &Path, language: &str) -> Result<Value, String> {
    let lang = if language == "de" { "de" } else { "en" };
    let mut g = RIVEN_META.lock().await;
    let file = cache_dir(data).join(format!("riven-meta-{lang}.json"));
    if g.as_ref().map_or(true, |(_, l, _)| l != lang) {
        *g = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| (v["ts"].as_i64().unwrap_or(0), lang.to_string(), v));
    }
    if let Some((ts, _, v)) = g.as_ref() {
        if now_ms() - ts < RIVEN_META_TTL_MS {
            return Ok(v.clone());
        }
    }
    let fetched = async {
        let w = market_get_ex("/v2/riven/weapons", lang, &|| false).await?;
        let a = market_get_ex("/v2/riven/attributes", lang, &|| false).await?;
        Ok::<_, MarketError>((w, a))
    }
    .await;
    match fetched {
        Ok((w, a)) => {
            let name = |x: &Value| x["i18n"][lang]["name"].as_str().or_else(|| x["i18n"]["en"]["name"].as_str()).or_else(|| x["slug"].as_str()).unwrap_or("").to_string();
            let weapons: Vec<Value> = w["data"].as_array().into_iter().flatten().map(|x| json!({
                "gameRef": x["gameRef"], "slug": x["slug"], "name": name(x),
                "thumb": x["i18n"]["en"]["thumb"].as_str().map(|t| format!("{MARKET_ASSETS}{t}")),
                "disposition": x.get("disposition").cloned().unwrap_or(Value::Null),
                "mr": x.get("reqMasteryRank").cloned().unwrap_or(Value::Null),
            })).collect();
            let attributes: Vec<Value> = a["data"].as_array().into_iter().flatten().map(|x| json!({
                "gameRef": x["gameRef"], "slug": x["slug"], "name": name(x), "unit": x.get("unit").cloned().unwrap_or(Value::Null),
            })).collect();
            let ts = now_ms();
            let v = json!({ "ts": ts, "weapons": weapons, "attributes": attributes });
            let _ = crate::paths::write_atomic(&file, &v.to_string());
            *g = Some((ts, lang.to_string(), v.clone()));
            Ok(v)
        }
        Err(e) => g.as_ref().map(|(_, _, v)| v.clone()).ok_or_else(|| e.into()),
    }
}

static AUCTIONS: Mutex<Option<HashMap<String, (i64, Value)>>> = Mutex::const_new(None);
/// Wird beim Wegklicken erhöht: wartende Auktions-Anfragen gehen dann gar nicht erst raus.
static AUCTION_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const AUCTION_TTL_MS: i64 = 15 * 60 * 1000;
const AUCTION_LIMIT: usize = 500;

pub fn cancel_auctions() {
    AUCTION_EPOCH.fetch_add(1, Ordering::SeqCst);
}

async fn search_auctions(weapon: &str, stats: &str) -> Result<Value, String> {
    let key = format!("{weapon}|{stats}");
    if let Some((ts, v)) = AUCTIONS.lock().await.as_ref().and_then(|m| m.get(&key).cloned()) {
        if now_ms() - ts < AUCTION_TTL_MS {
            return Ok(v);
        }
    }
    let epoch = AUCTION_EPOCH.load(Ordering::SeqCst);
    let enc = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ',')).collect::<String>();
    let q = format!(
        "type=riven&weapon_url_name={}&sort_by=price_asc{}",
        enc(weapon),
        if stats.is_empty() { String::new() } else { format!("&positive_stats={}", enc(stats)) }
    );
    let r = market_get_ex(&format!("/v1/auctions/search?{q}"), "en", &|| AUCTION_EPOCH.load(Ordering::SeqCst) != epoch).await?;
    let raw = r["payload"]["auctions"].as_array().cloned().unwrap_or_default();
    let mut list: Vec<Value> = raw
        .iter()
        .filter(|a| a["buyout_price"].as_i64().is_some() && !a["closed"].as_bool().unwrap_or(false) && a["visible"].as_bool().unwrap_or(true))
        .map(|a| json!({
            "id": a["id"], "price": a["buyout_price"],
            "seller": a["owner"]["ingame_name"].as_str().unwrap_or("?"),
            "status": a["owner"]["status"].as_str().unwrap_or("offline"),
            "rerolls": a["item"]["re_rolls"].as_i64().unwrap_or(0),
            "name": a["item"]["name"].as_str().unwrap_or(""),
            "attributes": a["item"]["attributes"].clone(),
        }))
        .collect();
    list.sort_by_key(|a| a["price"].as_i64().unwrap_or(i64::MAX));
    let v = json!({ "list": list, "complete": raw.len() < AUCTION_LIMIT });
    AUCTIONS.lock().await.get_or_insert_with(HashMap::new).insert(key, (now_ms(), v.clone()));
    Ok(v)
}

/// Günstigste Sofortkauf-Angebote einer Waffe, optional nur mit diesen positiven Stats.
/// Ist die Liste aller Angebote vollständig, wird lokal gefiltert statt erneut gefragt (spart das knappe Limit).
pub async fn riven_auctions(weapon: &str, positive: Vec<String>) -> Result<Value, String> {
    let all = search_auctions(weapon, "").await?;
    if positive.is_empty() {
        return Ok(all["list"].clone());
    }
    if all["complete"].as_bool().unwrap_or(false) {
        let filtered: Vec<Value> = all["list"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|a| positive.iter().all(|s| a["attributes"].as_array().into_iter().flatten().any(|at| at["positive"].as_bool().unwrap_or(false) && at["url_name"].as_str() == Some(s))))
            .cloned()
            .collect();
        return Ok(json!(filtered));
    }
    let mut stats = positive.clone();
    stats.sort();
    Ok(search_auctions(weapon, &stats.join(",")).await?["list"].clone())
}

/// Top-Aufträge eines Items (nur Spieler, die gerade online sind); rank filtert Mods/Arcanes.
pub async fn top_orders(slug: &str, rank: Option<u32>) -> Result<Value, String> {
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Ungültiger Item-Name".into());
    }
    let q = rank.map(|r| format!("?rank={r}")).unwrap_or_default();
    let r = market_get(&format!("/v2/orders/item/{slug}/top{q}")).await?;
    Ok(json!({ "sell": r["data"]["sell"].clone(), "buy": r["data"]["buy"].clone() }))
}

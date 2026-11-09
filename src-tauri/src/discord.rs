//! Discord-Anbindung (Einstellungen → Discord), Port von electron/discord.cjs:
//!
//! 1. Rich Presence über die lokale IPC-Pipe des Discord-Clients (\\.\pipe\discord-ipc-0..9),
//!    eigene Mini-Implementierung des RPC-Protokolls (Handshake, SET_ACTIVITY, PING/PONG).
//!    Läuft Discord nicht oder fehlt die Application-ID, gibt es nur einen Status; neuer Versuch alle 30 s.
//!    Die Aktivität („Im Orbiter“, „In Mission: …“) kommt aus EE.log.
//! 2. Webhooks: Meldungen (Preis-Alarm, Foundry, Baro, Weltstatus) als Embed in einen Kanal.
//!    Die URL liegt nur lokal (mit Windows-DPAPI verschlüsselt), geht nie an die Oberfläche (nur maskiert)
//!    und landet nie im Protokoll. Gesendet wird nacheinander; bei 429 wird retry_after abgewartet.
use crate::net::{client, now_ms};
use crate::{logger, AppState};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

const GITHUB_URL: &str = "https://github.com/TvMerlinTv/Cephalon-Merlin";
const TICK: Duration = Duration::from_secs(15);
const RETRY_MS: i64 = 30_000;
const MIN_GAP: Duration = Duration::from_secs(4);

fn valid_app_id(s: &str) -> bool {
    (17..=21).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit())
}

// ---------------------------------------------------------------- Aktivität aus EE.log
#[derive(Default, Clone, PartialEq, Debug)]
struct Place {
    kind: &'static str, // orbiter | dojo | duviri | hub | mission
    name: String,
    relay: bool,
}
#[derive(Default)]
struct Parse {
    pending: Option<(String, bool)>, // (Name, Hub?)
    place: Option<Place>,
}

/// Wertet eine EE.log-Zeile aus; true, wenn sich der Ort geändert hat.
fn parse_line(st: &mut Parse, line: &str) -> bool {
    if let Some(i) = line.find("Cached mission name=") {
        let rest = line[i + 20..].trim_end();
        // "Maroo's Bazaar (Mars) (TradeHUB1)" -> Name + Code am Ende
        let (name, code) = match rest.rfind(" (") {
            Some(p) if rest.ends_with(')') && !rest[p + 2..rest.len() - 1].contains(char::is_whitespace) && !rest[p + 2..rest.len() - 1].contains('(') => {
                (rest[..p].to_string(), rest[p + 2..rest.len() - 1].to_string())
            }
            _ => (rest.to_string(), String::new()),
        };
        st.pending = Some((name.trim().to_string(), code.to_lowercase().contains("hub")));
        return false;
    }
    if let Some(i) = line.find("ThemedSquadOverlay.lua: Mission name: ") {
        let hub = st.pending.as_ref().is_some_and(|p| p.1);
        st.pending = Some((line[i + 38..].trim().to_string(), hub));
        return false;
    }
    let Some(i) = line.find("Game successfully connected to: ") else { return false };
    let level = line[i + 32..].split_whitespace().next().unwrap_or("");
    let lower = level.to_lowercase();
    let before = st.place.clone();
    let place = if lower.contains("tailorshop") || lower.contains("/orbiter") {
        Place { kind: "orbiter", ..Default::default() }
    } else if lower.contains("/clan/") || lower.contains("dojo") {
        Place { kind: "dojo", ..Default::default() }
    } else if lower.contains("/duviri/") && st.pending.is_none() {
        Place { kind: "duviri", ..Default::default() }
    } else if st.pending.as_ref().is_some_and(|p| p.1) || lower.contains("/hub/") {
        Place { kind: "hub", name: st.pending.as_ref().map(|p| p.0.clone()).unwrap_or_default(), relay: lower.contains("relay") }
    } else {
        Place { kind: "mission", name: st.pending.as_ref().map(|p| p.0.clone()).unwrap_or_default(), relay: false }
    };
    if place.kind != "mission" && place.kind != "hub" {
        st.pending = None;
    }
    st.place = Some(place);
    st.place != before
}

/// "Descend (Dark Refractory, Deimos) - THE STEEL PATH" -> "Descend (Dark Refractory, Deimos) · Steel Path"
fn tidy_name(name: &str) -> String {
    let mut s = name.trim().to_string();
    if let Some(p) = s.to_uppercase().rfind(" - ALERT") {
        if p + 8 == s.len() {
            s.truncate(p);
        }
    }
    if let Some(p) = s.rfind(" - ") {
        let tail = &s[p + 3..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_uppercase() || c == ' ') {
            let t = tail.strip_prefix("THE ").unwrap_or(tail);
            let nice: Vec<String> = t
                .split_whitespace()
                .map(|w| {
                    let w = w.to_lowercase();
                    let mut c = w.chars();
                    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
                })
                .collect();
            s = format!("{} · {}", &s[..p], nice.join(" "));
        }
    }
    s.trim().to_string()
}

fn text(en: bool, key: &str, x: &str) -> String {
    let (de, eng) = match key {
        "playing" => ("Spielt Warframe", "Playing Warframe"),
        "orbiter" => ("Im Orbiter", "In the Orbiter"),
        "dojo" => ("Im Dojo", "In the Dojo"),
        "relay" => ("Im Relais", "In a Relay"),
        "duviri" => ("In Duviri", "In Duviri"),
        "in" => ("In {x}", "In {x}"),
        "mission" => ("In Mission: {x}", "In mission: {x}"),
        "missionAny" => ("In einer Mission", "In a mission"),
        _ => ("Plant mit Cephalon Merlin", "Planning with Cephalon Merlin"),
    };
    (if en { eng } else { de }).replace("{x}", x)
}

fn place_text(place: Option<&Place>, en: bool) -> String {
    let Some(p) = place else { return text(en, "playing", "") };
    match p.kind {
        "orbiter" | "dojo" | "duviri" => text(en, p.kind, ""),
        "hub" => {
            // "Maroo's Bazaar (Mars)" -> "In Maroo's Bazaar"
            let mut n = tidy_name(&p.name);
            if n.ends_with(')') {
                if let Some(i) = n.rfind(" (") {
                    n.truncate(i);
                }
            }
            if !n.is_empty() {
                text(en, "in", &n)
            } else if p.relay {
                text(en, "relay", "")
            } else {
                text(en, "playing", "")
            }
        }
        _ => {
            let n = tidy_name(&p.name);
            if n.is_empty() { text(en, "missionAny", "") } else { text(en, "mission", &n) }
        }
    }
}

// ---------------------------------------------------------------- Minimaler RPC-Client
#[cfg(windows)]
mod rpc {
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
    use tokio::sync::Mutex;

    pub const HANDSHAKE: i32 = 0;
    pub const FRAME: i32 = 1;
    pub const CLOSE: i32 = 2;
    pub const PING: i32 = 3;
    pub const PONG: i32 = 4;

    pub struct Conn {
        pub writer: Arc<Mutex<WriteHalf<NamedPipeClient>>>,
        pub user: String,
        pub alive: Arc<std::sync::atomic::AtomicBool>,
    }

    fn encode(op: i32, data: &Value) -> Vec<u8> {
        let body = data.to_string().into_bytes();
        let mut out = Vec::with_capacity(8 + body.len());
        out.extend_from_slice(&op.to_le_bytes());
        out.extend_from_slice(&(body.len() as i32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    async fn read_frame(r: &mut ReadHalf<NamedPipeClient>) -> std::io::Result<(i32, Value)> {
        let mut head = [0u8; 8];
        r.read_exact(&mut head).await?;
        let op = i32::from_le_bytes(head[0..4].try_into().unwrap());
        let len = i32::from_le_bytes(head[4..8].try_into().unwrap());
        if !(0..=1_000_000).contains(&len) {
            return Err(std::io::Error::other("Ungültige Antwort von Discord"));
        }
        let mut body = vec![0u8; len as usize];
        r.read_exact(&mut body).await?;
        Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
    }

    pub enum ConnectError {
        NoDiscord,
        InvalidId,
        Other(String),
    }

    /// Verbindet sich mit dem ersten erreichbaren Discord-Client und meldet sich mit der Application-ID an.
    pub async fn connect(client_id: &str) -> Result<Conn, ConnectError> {
        let pipe = (0..10).find_map(|i| ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{i}")).ok()).ok_or(ConnectError::NoDiscord)?;
        let (mut r, mut w) = tokio::io::split(pipe);
        w.write_all(&encode(HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))).await.map_err(|e| ConnectError::Other(e.to_string()))?;
        // Auf READY warten (höchstens 10 s)
        let ready = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let (op, msg) = read_frame(&mut r).await.map_err(|e| ConnectError::Other(e.to_string()))?;
                if op == CLOSE {
                    let invalid = msg["code"] == 4000 || msg["message"].as_str().unwrap_or("").to_lowercase().contains("client id");
                    return Err(if invalid { ConnectError::InvalidId } else { ConnectError::Other(format!("Discord: {} ({})", msg["message"].as_str().unwrap_or("getrennt"), msg["code"])) });
                }
                if op == FRAME && msg["cmd"] == "DISPATCH" && msg["evt"] == "READY" {
                    let u = &msg["data"]["user"];
                    return Ok(u["global_name"].as_str().or_else(|| u["username"].as_str()).unwrap_or("").to_string());
                }
            }
        })
        .await
        .map_err(|_| ConnectError::Other("Discord antwortet nicht".into()))??;
        let writer = Arc::new(Mutex::new(w));
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        // Leser im Hintergrund: PING beantworten, Fehler protokollieren, Trennung merken
        let (w2, a2) = (writer.clone(), alive.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                match read_frame(&mut r).await {
                    Ok((PING, msg)) => {
                        let _ = w2.lock().await.write_all(&encode(PONG, &msg)).await;
                    }
                    Ok((CLOSE, _)) | Err(_) => break,
                    Ok((_, msg)) => {
                        if msg["evt"] == "ERROR" {
                            crate::logger::warn("discord", format!("Status setzen fehlgeschlagen: {}", msg["data"]["message"].as_str().unwrap_or("?")));
                        }
                    }
                }
            }
            a2.store(false, std::sync::atomic::Ordering::SeqCst);
        });
        Ok(Conn { writer, user: ready, alive })
    }

    impl Conn {
        pub async fn set_activity(&self, activity: Option<&Value>) -> std::io::Result<()> {
            let mut args = json!({ "pid": std::process::id() });
            if let Some(a) = activity {
                args["activity"] = a.clone();
            }
            let nonce = format!("{:x}", crate::net::now_ms());
            let frame = encode(FRAME, &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": nonce }));
            self.writer.lock().await.write_all(&frame).await
        }
        pub fn is_alive(&self) -> bool {
            self.alive.load(std::sync::atomic::Ordering::SeqCst)
        }
        pub async fn close(&self) {
            let _ = self.set_activity(None).await;
            let _ = self.writer.lock().await.shutdown().await;
        }
    }
}

// ---------------------------------------------------------------- Rich Presence
struct Presence {
    #[cfg(windows)]
    conn: Option<rpc::Conn>,
    connected_id: String,
    retry_at: i64,
    status: Value,
    last_sent: Option<String>,
    last_sent_at: Option<Instant>,
    game_running: bool,
    game_start: i64,
    parse: Parse,
    log_pos: Option<u64>,
}
static PRESENCE: Mutex<Option<Presence>> = Mutex::const_new(None);
static STATUS: StdMutex<Option<Value>> = StdMutex::new(None);
static APP_START: std::sync::OnceLock<i64> = std::sync::OnceLock::new();

pub fn status() -> Value {
    STATUS.lock().ok().and_then(|s| s.clone()).unwrap_or_else(|| json!({ "state": "off" }))
}

fn set_status(app: &AppHandle, p: &mut Presence, next: Value) {
    if p.status != next {
        p.status = next.clone();
        if let Ok(mut s) = STATUS.lock() {
            *s = Some(next.clone());
        }
        let _ = app.emit("discord-status", next);
    }
}

fn ee_log() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Warframe").join("EE.log"))
}

/// Neue Zeilen aus EE.log lesen (beim ersten Mal das ganze Log, um den aktuellen Ort zu kennen).
fn read_log(p: &mut Presence) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Some(file) = ee_log() else { return false };
    let Ok(meta) = std::fs::metadata(&file) else { return false };
    let size = meta.len();
    let start = match p.log_pos {
        Some(pos) if pos <= size => pos,
        _ => {
            p.parse = Parse::default();
            0
        }
    };
    if start == size {
        return false;
    }
    let Ok(mut f) = std::fs::File::open(&file) else { return false };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = f.take(size - start).read_to_end(&mut buf);
    // Nur bis zur letzten vollständigen Zeile
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    p.log_pos = Some(start + end as u64);
    let text: String = buf[..end].iter().map(|&b| b as char).collect();
    let mut changed = false;
    for line in text.lines() {
        if line.contains("ission name") || line.contains("successfully connected") {
            changed |= parse_line(&mut p.parse, line);
        }
    }
    changed
}

/// MR aus inventory.json und Spielername aus player.json.
fn profile(data: &Path) -> (Option<i64>, Option<String>) {
    let mr = std::fs::read_to_string(data.join("inventory.json")).ok().and_then(|t| {
        let i = t.find("\"PlayerLevel\"")?;
        let rest = t[i + 13..].trim_start().strip_prefix(':')?.trim_start();
        rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok()
    });
    let name = std::fs::read_to_string(data.join("player.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["name"].as_str().map(String::from));
    (mr, name)
}

fn build_activity(p: &Presence, s: &Value, data: &Path) -> Option<Value> {
    let en = s["language"] == "en";
    let flag = |k: &str, d: bool| s[k].as_bool().unwrap_or(d);
    let mut a = if !p.game_running {
        if !flag("discordIdle", false) {
            return None;
        }
        json!({ "details": "Cephalon Merlin", "state": text(en, "idle", ""), "timestamps": { "start": APP_START.get().copied().unwrap_or_else(now_ms) } })
    } else {
        let (mr, name) = profile(data);
        let mut parts = Vec::new();
        if flag("discordShowName", false) {
            if let Some(n) = name {
                parts.push(n);
            }
        }
        if flag("discordShowMr", true) {
            if let Some(m) = mr {
                parts.push(format!("MR {m}"));
            }
        }
        parts.push("Cephalon Merlin".into());
        let state = if flag("discordShowActivity", true) { place_text(p.parse.place.as_ref(), en) } else { text(en, "playing", "") };
        json!({ "details": parts.join(" · "), "state": state, "timestamps": { "start": if p.game_start > 0 { p.game_start } else { now_ms() } } })
    };
    for k in ["details", "state"] {
        let v: String = a[k].as_str().unwrap_or("").chars().take(128).collect();
        a[k] = json!(v);
    }
    a["assets"] = json!({ "large_image": "logo", "large_text": "Cephalon Merlin" });
    if flag("discordButton", true) {
        a["buttons"] = json!([{ "label": "Cephalon Merlin", "url": GITHUB_URL }]);
    }
    Some(a)
}

async fn tick(app: &AppHandle) {
    let st = app.state::<AppState>();
    let s = st.settings.get();
    let data = st.data.clone();
    let mut g = PRESENCE.lock().await;
    let p = g.get_or_insert_with(|| Presence {
        #[cfg(windows)]
        conn: None,
        connected_id: String::new(),
        retry_at: 0,
        status: json!({ "state": "off" }),
        last_sent: None,
        last_sent_at: None,
        game_running: false,
        game_start: 0,
        parse: Parse::default(),
        log_pos: None,
    });
    let app_id = s["discordAppId"].as_str().unwrap_or("").to_string();
    #[cfg(windows)]
    let disconnect = |p: &mut Presence| {
        let c = p.conn.take();
        p.last_sent = None;
        p.connected_id.clear();
        c
    };
    if !s["discordRpc"].as_bool().unwrap_or(false) || !valid_app_id(&app_id) {
        #[cfg(windows)]
        if let Some(c) = disconnect(p) {
            c.close().await;
        }
        let state = if s["discordRpc"].as_bool().unwrap_or(false) { "noId" } else { "off" };
        set_status(app, p, json!({ "state": state }));
        return;
    }
    let running = crate::game::reader::game_running();
    if running && !p.game_running {
        // Startzeit: EE.log wird beim Spielstart neu angelegt
        let born = ee_log()
            .and_then(|f| std::fs::metadata(f).ok())
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .filter(|&b| b > now_ms() - 12 * 3_600_000 && b <= now_ms());
        p.game_start = born.unwrap_or_else(now_ms);
        p.log_pos = None;
    }
    p.game_running = running;
    if running && s["discordShowActivity"].as_bool().unwrap_or(true) {
        read_log(p);
    }
    #[cfg(windows)]
    {
        if p.conn.as_ref().is_some_and(|c| !c.is_alive()) {
            p.conn = None;
            p.connected_id.clear();
            p.last_sent = None;
            p.retry_at = now_ms() + RETRY_MS;
            logger::info("discord", "Verbindung zu Discord getrennt – neuer Versuch in 30 s");
            set_status(app, p, json!({ "state": "noDiscord" }));
        }
        if !running && !s["discordIdle"].as_bool().unwrap_or(false) && p.conn.is_none() {
            let keep_error = p.status["state"] == "error";
            if !keep_error {
                set_status(app, p, json!({ "state": "waiting" }));
            }
            return;
        }
        if p.conn.is_some() && p.connected_id != app_id {
            if let Some(c) = disconnect(p) {
                c.close().await;
            }
        }
        if p.conn.is_none() {
            if now_ms() < p.retry_at {
                return;
            }
            set_status(app, p, json!({ "state": "connecting" }));
            match rpc::connect(&app_id).await {
                Ok(c) => {
                    logger::info("discord", "Rich Presence verbunden");
                    set_status(app, p, json!({ "state": "connected", "user": c.user }));
                    p.conn = Some(c);
                    p.connected_id = app_id.clone();
                    p.last_sent = None;
                }
                Err(e) => {
                    p.retry_at = now_ms() + RETRY_MS;
                    match e {
                        rpc::ConnectError::NoDiscord => {
                            logger::info("discord", "Rich Presence: Discord läuft nicht (keine IPC-Pipe gefunden)");
                            set_status(app, p, json!({ "state": "noDiscord" }));
                        }
                        rpc::ConnectError::InvalidId => {
                            logger::warn("discord", "Rich Presence: Discord kennt diese Application-ID nicht");
                            set_status(app, p, json!({ "state": "error", "message": "Discord kennt diese Application-ID nicht", "code": "INVALID_ID" }));
                        }
                        rpc::ConnectError::Other(m) => {
                            logger::warn("discord", format!("Rich Presence: {m}"));
                            set_status(app, p, json!({ "state": "error", "message": m }));
                        }
                    }
                    return;
                }
            }
        }
        // Aktivität senden, wenn sie sich geändert hat (mit Mindestabstand)
        let activity = build_activity(p, &s, &data);
        let key = activity.as_ref().map(|a| a.to_string()).unwrap_or_else(|| "null".into());
        if p.last_sent.as_deref() == Some(key.as_str()) || p.last_sent_at.is_some_and(|t| t.elapsed() < MIN_GAP) {
            return;
        }
        if let Some(c) = &p.conn {
            if c.set_activity(activity.as_ref()).await.is_ok() {
                p.last_sent = Some(key);
                p.last_sent_at = Some(Instant::now());
            }
        }
    }
}

pub fn start(app: AppHandle) {
    let _ = APP_START.set(now_ms());
    tauri::async_runtime::spawn(async move {
        loop {
            tick(&app).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

/// Nach Einstellungs-Änderungen oder „Jetzt verbinden“: sofort neu prüfen.
pub async fn retry(app: &AppHandle) -> Value {
    if let Some(p) = PRESENCE.lock().await.as_mut() {
        p.retry_at = 0;
        p.last_sent = None;
        p.last_sent_at = None;
    }
    tick(app).await;
    status()
}

// ---------------------------------------------------------------- Webhooks
const HOOK_KINDS: [&str; 4] = ["priceAlert", "foundry", "baro", "world"];
const WEBHOOK_FILE: &str = "discord-webhook-rs.json";

/// Nur https://discord.com/api/webhooks/<id>/<token> (oder discordapp.com, optional /api/v10/).
fn validate_url(input: &str) -> Option<String> {
    let s = input.trim();
    if s.len() > 300 {
        return None;
    }
    let rest = s.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    if host != "discord.com" && host != "discordapp.com" {
        return None;
    }
    let path = path.strip_prefix("api/")?;
    let path = match path.split_once('/') {
        Some((v, p)) if v.len() >= 2 && v.len() <= 3 && v.starts_with('v') && v[1..].chars().all(|c| c.is_ascii_digit()) => p,
        _ => path,
    };
    let path = path.strip_prefix("webhooks/")?.trim_end_matches('/');
    let (id, token) = path.split_once('/')?;
    let id_ok = (17..=21).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit());
    let token_ok = (30..=100).contains(&token.len()) && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    (id_ok && token_ok).then(|| format!("https://{host}/api/webhooks/{id}/{token}"))
}

fn mask(url: &str) -> String {
    let Some(rest) = url.strip_prefix("https://") else { return String::new() };
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() < 5 {
        return String::new();
    }
    let (host, id, token) = (parts[0], parts[3], parts[4]);
    format!("https://{host}/api/webhooks/{}…/••••••••{}", &id[..4.min(id.len())], &token[token.len().saturating_sub(4)..])
}

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        let ok = if protect {
            CryptProtectData(&input, None, None, None, None, 0, &mut out)
        } else {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut out)
        };
        ok.ok()?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Some(v)
    }
}
#[cfg(not(windows))]
fn dpapi(_: &[u8], _: bool) -> Option<Vec<u8>> {
    None
}

static WEBHOOK: StdMutex<Option<Option<String>>> = StdMutex::new(None);

fn read_url(data: &Path) -> Option<String> {
    let mut g = WEBHOOK.lock().ok()?;
    if let Some(c) = g.as_ref() {
        return c.clone();
    }
    use base64::Engine;
    let url = std::fs::read_to_string(data.join(WEBHOOK_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| base64::engine::general_purpose::STANDARD.decode(v["v"].as_str()?).ok())
        .and_then(|b| dpapi(&b, false))
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|u| validate_url(&u));
    *g = Some(url.clone());
    url
}

fn write_url(data: &Path, url: Option<&str>) -> Result<(), String> {
    use base64::Engine;
    let file = data.join(WEBHOOK_FILE);
    match url {
        None => {
            let _ = std::fs::remove_file(&file);
        }
        Some(u) => {
            let enc = dpapi(u.as_bytes(), true).ok_or("Verschlüsseln fehlgeschlagen")?;
            let v = base64::engine::general_purpose::STANDARD.encode(enc);
            crate::paths::write_atomic(&file, &json!({ "enc": "dpapi", "v": v }).to_string()).map_err(|e| e.to_string())?;
        }
    }
    if let Ok(mut g) = WEBHOOK.lock() {
        *g = Some(url.map(String::from));
    }
    Ok(())
}

pub fn webhook_info(data: &Path) -> Value {
    let url = read_url(data);
    json!({ "set": url.is_some(), "masked": url.as_deref().map(mask).unwrap_or_default() })
}

pub fn webhook_set(data: &Path, input: &str) -> Result<Value, String> {
    if input.trim().is_empty() {
        write_url(data, None)?;
        return Ok(webhook_info(data));
    }
    let url = validate_url(input).ok_or("Ungültige Webhook-URL – erlaubt ist nur https://discord.com/api/webhooks/…")?;
    write_url(data, Some(&url))?;
    logger::info("discord", "Webhook gespeichert");
    Ok(webhook_info(data))
}

fn clamp(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() > n {
        format!("{}…", t.chars().take(n - 1).collect::<String>())
    } else {
        t.to_string()
    }
}

fn embed(title: &str, body: &str) -> Value {
    let mut e = json!({ "title": clamp(title, 256), "color": 0x8b6dff, "footer": { "text": "Cephalon Merlin" }, "timestamp": crate::logger::now_iso() });
    let d = clamp(body, 2000);
    if !d.is_empty() {
        e["description"] = json!(d);
    }
    // keine @everyone/@here aus Item-Namen o. Ä.
    json!({ "username": "Cephalon Merlin", "allowed_mentions": { "parse": [] }, "embeds": [e] })
}

/// Senden mit 429-Wartezeit (höchstens 3 Versuche). Fehlermeldungen enthalten nie die URL.
async fn post(url: &str, payload: &Value) -> Result<(), String> {
    for attempt in 1..=3 {
        let res = client()
            .post(url)
            .json(payload)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| if e.is_timeout() { "Discord antwortet nicht (Zeitüberschreitung)".to_string() } else { "Discord nicht erreichbar (Netzwerkfehler)".to_string() })?;
        let status = res.status().as_u16();
        if status == 429 && attempt < 3 {
            let header = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<f64>().ok());
            let body: Value = res.json().await.unwrap_or_default();
            let secs = body["retry_after"].as_f64().or(header).unwrap_or(1.0).clamp(0.2, 60.0);
            tokio::time::sleep(Duration::from_millis((secs * 1000.0) as u64 + 100)).await;
            continue;
        }
        if res.status().is_success() {
            if res.headers().get("x-ratelimit-remaining").and_then(|v| v.to_str().ok()) == Some("0") {
                if let Some(r) = res.headers().get("x-ratelimit-reset-after").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<f64>().ok()) {
                    tokio::time::sleep(Duration::from_millis((r.min(60.0) * 1000.0) as u64)).await;
                }
            }
            return Ok(());
        }
        return Err(match status {
            404 | 401 => format!("Diesen Webhook gibt es nicht mehr (HTTP {status}) – bitte neu anlegen"),
            429 => "Discord drosselt gerade (HTTP 429) – später erneut versuchen".into(),
            _ => format!("Discord hat abgelehnt (HTTP {status})"),
        });
    }
    Err("Discord drosselt gerade (HTTP 429) – später erneut versuchen".into())
}

/// Nacheinander senden (1 s Abstand).
static SEND: Mutex<()> = Mutex::const_new(());
async fn send_now(data: &Path, payload: Value) -> Result<(), String> {
    let _g = SEND.lock().await;
    let url = read_url(data).ok_or("Kein Webhook eingetragen")?;
    let r = post(&url, &payload).await;
    if let Err(e) = &r {
        logger::warn("discord", format!("Webhook: {e}")); // nie die URL
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    r
}

pub async fn webhook_test(data: &Path, en: bool) -> Result<Value, String> {
    let (title, body) = if en {
        ("Test from Cephalon Merlin", "The webhook works. Notifications you selected will show up here.")
    } else {
        ("Test von Cephalon Merlin", "Der Webhook funktioniert. Die ausgewählten Meldungen erscheinen ab jetzt hier.")
    };
    send_now(data, embed(title, body)).await?;
    Ok(webhook_info(data))
}

static RECENT: StdMutex<Option<HashMap<String, i64>>> = StdMutex::new(None);

/// Meldung an den Webhook, falls für diese Art eingeschaltet. Gleiche Meldung höchstens 1× pro Minute.
pub fn hook(app: &AppHandle, kind: &str, title: &str, body: &str) {
    let st = app.state::<AppState>();
    let s = st.settings.get();
    if !HOOK_KINDS.contains(&kind) || !s["discordHooks"][kind].as_bool().unwrap_or(false) || read_url(&st.data).is_none() {
        return;
    }
    let key = format!("{kind}|{title}|{body}");
    let now = now_ms();
    {
        let Ok(mut g) = RECENT.lock() else { return };
        let m = g.get_or_insert_with(HashMap::new);
        m.retain(|_, at| now - *at < 60_000);
        if m.contains_key(&key) {
            return;
        }
        m.insert(key, now);
    }
    let data = st.data.clone();
    let payload = embed(title, body);
    tauri::async_runtime::spawn(async move {
        let _ = send_now(&data, payload).await;
    });
}

/// Logo für das Asset „logo“ im Developer Portal in den Datenordner legen.
pub fn logo_file(data: &Path) -> Option<PathBuf> {
    let target = data.join("discord-logo.png");
    std::fs::write(&target, include_bytes!("../data/discord-logo.png")).ok()?;
    Some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_urls() {
        let ok = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
        assert_eq!(validate_url(ok).as_deref(), Some(ok));
        assert!(validate_url("https://discord.com/api/v10/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD/").is_some());
        assert!(validate_url("https://evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD").is_none());
        assert!(validate_url("http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD").is_none());
        assert_eq!(mask(ok), "https://discord.com/api/webhooks/1234…/••••••••ABCD");
    }

    #[test]
    fn places() {
        let mut st = Parse::default();
        parse_line(&mut st, "ThemedSquadOverlay.lua: Cached mission name=Maroo's Bazaar (Mars) (TradeHUB1)");
        parse_line(&mut st, "Sys [Info]: ===[ Game successfully connected to: /Lotus/Levels/Hub/TradeHub.lp ]===");
        assert_eq!(place_text(st.place.as_ref(), false), "In Maroo's Bazaar");
        parse_line(&mut st, "Sys [Info]: ===[ Game successfully connected to: /Lotus/Levels/Proc/Vania/VaniaTailorShopWinterSnow/BkA.lp ]===");
        assert_eq!(place_text(st.place.as_ref(), false), "Im Orbiter");
        parse_line(&mut st, "ThemedSquadOverlay.lua: Mission name: Descend (Dark Refractory, Deimos) - THE STEEL PATH");
        parse_line(&mut st, "Sys [Info]: ===[ Game successfully connected to: /Lotus/Levels/Proc/Deimos/X.lp ]===");
        assert_eq!(place_text(st.place.as_ref(), true), "In mission: Descend (Dark Refractory, Deimos) · Steel Path");
    }
}

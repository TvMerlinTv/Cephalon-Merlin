//! Selbst-Update der .exe über GitHub-Releases (ohne Token, nur lesend).
//!
//! Gegenüber electron/updater.cjs vereinfacht – eine Tauri-.exe ist klein (≈ 5 MB), deshalb
//! kein „kleines Update“ und kein PowerShell-Hilfsskript:
//!  1. GET /repos/<REPO>/releases – das neueste Release mit dem Asset „Cephalon-Merlin-RS.exe“
//!     (die Electron-Releases im selben Repository haben dieses Asset nicht und werden übersprungen)
//!  2. Download neben die laufende .exe (*.update.tmp), Prüfung: „MZ“ am Anfang und – wenn GitHub
//!     sie liefert – SHA-256 aus dem Asset-Feld „digest“
//!  3. Laufende .exe in *.old umbenennen (geht unter Windows auch im Betrieb), neue an ihren Platz,
//!     neue mit `--after-update <pid>` starten – sie wartet, bis diese hier beendet ist.
//!     *.old wird beim nächsten Start gelöscht.
//! Aktiv nur in der echten .exe (Release-Build, Dateiname ohne „Preview“).
use crate::net::{client, err_text, now_ms};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const REPO: &str = "TvMerlinTv/Cephalon-Merlin";
const ASSET: &str = "Cephalon-Merlin-RS.exe";
const FIRST_CHECK: Duration = Duration::from_secs(15);
const INTERVAL: Duration = Duration::from_secs(6 * 3600);

static STATE: Mutex<Option<Value>> = Mutex::new(None);
static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ---------------------------------------------------------------- Versionen

#[derive(Debug, PartialEq)]
enum Pre {
    Num(u64),
    Text(String),
}

/// "v0.2.0" / "rs-v0.3.0" / "0.2.0-beta.1" → (core, pre)
fn parse_version(v: &str) -> Option<([u64; 3], Vec<Pre>)> {
    let v = v.trim();
    let v = v.strip_prefix("rs-").unwrap_or(v);
    let v = v.strip_prefix('v').or_else(|| v.strip_prefix('V')).unwrap_or(v);
    let v = v.split('+').next()?;
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let nums: Vec<u64> = core.split('.').map(|n| n.parse().ok()).collect::<Option<_>>()?;
    let [a, b, c] = nums[..] else { return None };
    let pre = pre
        .map(|p| p.split('.').map(|x| x.parse().map(Pre::Num).unwrap_or_else(|_| Pre::Text(x.to_string()))).collect())
        .unwrap_or_default();
    Some(([a, b, c], pre))
}

/// Semver-Vergleich; ungültige Versionen zählen als 0.0.0.
fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    let pa = parse_version(a).unwrap_or(([0; 3], vec![]));
    let pb = parse_version(b).unwrap_or(([0; 3], vec![]));
    match pa.0.cmp(&pb.0) {
        Equal => {}
        o => return o,
    }
    // Vorabversion ist älter als die fertige
    match (pa.1.is_empty(), pb.1.is_empty()) {
        (true, true) => return Equal,
        (true, false) => return Greater,
        (false, true) => return Less,
        _ => {}
    }
    for i in 0..pa.1.len().max(pb.1.len()) {
        let o = match (pa.1.get(i), pb.1.get(i)) {
            (None, _) => Less,
            (_, None) => Greater,
            (Some(Pre::Num(x)), Some(Pre::Num(y))) => x.cmp(y),
            (Some(Pre::Num(_)), _) => Less,
            (_, Some(Pre::Num(_))) => Greater,
            (Some(Pre::Text(x)), Some(Pre::Text(y))) => x.cmp(y),
        };
        if o != Equal {
            return o;
        }
    }
    Equal
}

/// GitHub ersetzt Leerzeichen im Namen durch Punkte – deshalb normalisiert vergleichen. Kein Raten:
/// nur genau dieses Asset (sonst könnte eine Electron-.exe genommen werden).
fn pick_asset(assets: &Value) -> Option<&Value> {
    let norm = |s: &str| s.to_lowercase().chars().filter(|c| !matches!(c, ' ' | '.' | '_' | '-')).collect::<String>();
    let want = norm(ASSET);
    assets.as_array()?.iter().find(|a| a["name"].as_str().is_some_and(|n| norm(n) == want) && a["browser_download_url"].is_string())
}

/// Neuestes passendes Release aus der Liste (ohne Entwürfe und Vorabversionen).
fn evaluate(releases: &Value, current: &str) -> Option<Value> {
    let best = releases
        .as_array()?
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false) && !r["prerelease"].as_bool().unwrap_or(false))
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            parse_version(tag)?;
            Some((r, tag, pick_asset(&r["assets"])?))
        })
        .max_by(|a, b| compare(a.1, b.1))?;
    let (r, tag, asset) = best;
    let version = tag.trim_start_matches("rs-").trim_start_matches(['v', 'V']).to_string();
    let notes: String = r["body"].as_str().unwrap_or("").chars().take(20_000).collect();
    let sha = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).filter(|d| d.len() == 64).map(str::to_lowercase);
    Some(json!({
        "newer": compare(&version, current).is_gt(),
        "version": version,
        "name": r["name"].as_str().filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| format!("v{version}")),
        "notes": notes,
        "url": r["html_url"],
        "publishedAt": r["published_at"],
        "asset": { "name": asset["name"], "url": asset["browser_download_url"], "size": asset["size"], "sha256": sha },
    }))
}

// ---------------------------------------------------------------- Zustand

fn exe() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

/// Nur die echte .exe aktualisiert sich selbst (nicht Preview, nicht Debug).
fn can_install() -> bool {
    !cfg!(debug_assertions)
        && exe().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).is_some_and(|n| !n.contains("preview"))
}

pub fn state(app: &AppHandle) -> Value {
    let mut s = STATE.lock().map(|s| s.clone()).ok().flatten().unwrap_or_else(|| json!({ "status": "idle" }));
    s["current"] = json!(app.package_info().version.to_string());
    s["repo"] = json!(REPO);
    s["canInstall"] = json!(can_install());
    s
}

fn set(app: &AppHandle, patch: Value) {
    if let Ok(mut s) = STATE.lock() {
        let cur = s.get_or_insert_with(|| json!({ "status": "idle" }));
        if let (Some(c), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                c.insert(k.clone(), v.clone());
            }
        }
    }
    let _ = app.emit("update-state", state(app));
}

fn status(app: &AppHandle) -> String {
    state(app)["status"].as_str().unwrap_or("idle").to_string()
}

pub async fn check(app: &AppHandle, manual: bool) -> Value {
    if matches!(status(app).as_str(), "downloading" | "installing") {
        return state(app);
    }
    let Ok(_g) = BUSY.try_lock() else {
        let _w = BUSY.lock().await;
        return state(app);
    };
    // Die Prüfung im Hintergrund zeigt keinen Lade-Zustand
    if manual {
        set(app, json!({ "status": "checking", "error": null }));
    }
    let current = app.package_info().version.to_string();
    let res = client()
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=30"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(Duration::from_secs(20))
        .send()
        .await;
    let result: Result<Value, String> = async {
        let res = res.map_err(err_text)?;
        if res.status().as_u16() == 404 {
            return Ok(json!({ "status": "none", "latest": null, "noRelease": true }));
        }
        if !res.status().is_success() {
            return Err(format!("GitHub antwortet mit HTTP {}", res.status().as_u16()));
        }
        let list: Value = res.json().await.map_err(err_text)?;
        Ok(match evaluate(&list, &current) {
            Some(latest) => {
                let st = if latest["newer"].as_bool() == Some(true) { "available" } else { "none" };
                json!({ "status": st, "latest": latest, "noRelease": false })
            }
            None => json!({ "status": "none", "latest": null, "noRelease": true }),
        })
    }
    .await;
    match result {
        Ok(mut patch) => {
            patch["error"] = Value::Null;
            patch["checkedAt"] = json!(now_ms());
            if patch["status"] == "available" && !manual {
                crate::logger::info("update", format!("Update {} verfügbar", patch["latest"]["version"]));
            }
            set(app, patch);
        }
        // Hintergrund-Fehler (offline usw.) nicht anzeigen, alten Stand behalten
        Err(e) if manual => set(app, json!({ "status": "error", "error": e })),
        Err(e) => crate::logger::warn("update", e),
    }
    state(app)
}

#[cfg(windows)]
fn sha256_hex(data: &[u8]) -> Option<String> {
    use windows::Win32::Security::Cryptography::{BCryptHash, BCRYPT_SHA256_ALG_HANDLE};
    let mut out = [0u8; 32];
    let st = unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut out) };
    st.is_ok().then(|| out.iter().map(|b| format!("{b:02x}")).collect())
}
#[cfg(not(windows))]
fn sha256_hex(_data: &[u8]) -> Option<String> {
    None
}

pub async fn install(app: &AppHandle) -> Result<bool, String> {
    if !can_install() {
        return Err("Aktualisieren geht nur in der fertigen .exe – lade die neue Version sonst von GitHub.".into());
    }
    let st = state(app);
    let latest = st["latest"].clone();
    if st["status"] != "available" || latest["asset"]["url"].as_str().is_none() {
        return Err("Kein Update verfügbar".into());
    }
    let exe = exe().ok_or("Pfad der .exe unbekannt")?;
    let tmp = exe.with_extension("update.tmp");
    let size = latest["asset"]["size"].as_u64().unwrap_or(0);
    set(app, json!({ "status": "downloading", "progress": { "done": 0, "total": size }, "error": null }));
    let r = download(app, &latest, &tmp, size).await.and_then(|()| swap(&exe, &tmp));
    match r {
        Ok(()) => {
            set(app, json!({ "status": "installing" }));
            crate::logger::info("update", format!("Update {} eingespielt – Neustart", latest["version"]));
            let pid = std::process::id().to_string();
            std::process::Command::new(&exe)
                .args(["--after-update", &pid])
                .current_dir(exe.parent().unwrap_or(std::path::Path::new(".")))
                .spawn()
                .map_err(|e| format!("Neustart fehlgeschlagen: {e}"))?;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                app.exit(0);
            });
            Ok(true)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            set(app, json!({ "status": "available", "progress": null, "error": e }));
            Err(e)
        }
    }
}

async fn download(app: &AppHandle, latest: &Value, tmp: &PathBuf, size: u64) -> Result<(), String> {
    let url = latest["asset"]["url"].as_str().unwrap_or("");
    let mut res = client()
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(err_text)?;
    if !res.status().is_success() {
        return Err(format!("Download fehlgeschlagen (HTTP {})", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(size);
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = std::time::Instant::now();
    while let Some(chunk) = res.chunk().await.map_err(err_text)? {
        buf.extend_from_slice(&chunk);
        if last.elapsed() > Duration::from_millis(150) {
            last = std::time::Instant::now();
            set(app, json!({ "progress": { "done": buf.len(), "total": total } }));
        }
    }
    set(app, json!({ "progress": { "done": buf.len(), "total": total } }));
    if size > 0 && buf.len() as u64 != size {
        return Err("Download unvollständig".into());
    }
    // Windows-Programme beginnen mit „MZ“
    if !buf.starts_with(b"MZ") {
        return Err("Heruntergeladene Datei ist keine .exe".into());
    }
    if let Some(want) = latest["asset"]["sha256"].as_str() {
        if sha256_hex(&buf).as_deref() != Some(want) {
            return Err("Update beschädigt (Prüfsumme falsch)".into());
        }
    }
    std::fs::write(tmp, &buf).map_err(|e| format!("Update speichern: {e}"))
}

/// Laufende .exe beiseite (*.old), neue an ihren Platz; bei einem Fehler zurück.
fn swap(exe: &PathBuf, tmp: &PathBuf) -> Result<(), String> {
    let old = exe.with_extension("exe.old");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| format!("Alte Version beiseitelegen: {e}"))?;
    if let Err(e) = std::fs::rename(tmp, exe) {
        let _ = std::fs::rename(&old, exe);
        return Err(format!("Neue Version einsetzen: {e}"));
    }
    Ok(())
}

/// Beim Start: Reste eines Updates aufräumen, dann im Hintergrund prüfen (nur in der echten .exe).
pub fn start(app: AppHandle) {
    if let Some(exe) = exe() {
        let old = exe.with_extension("exe.old");
        if old.exists() {
            tauri::async_runtime::spawn(async move {
                for _ in 0..20 {
                    if std::fs::remove_file(&old).is_ok() || !old.exists() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            });
        }
    }
    if !can_install() {
        return; // Preview/Dev: nur von Hand prüfen
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&app, false).await;
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

/// Nach einem Update: warten, bis die alte Instanz beendet ist (sonst greift die Einzel-Instanz-Sperre).
pub fn wait_for_previous() {
    let mut args = std::env::args();
    while let Some(a) = args.next() {
        if a == "--after-update" {
            if let Some(pid) = args.next().and_then(|p| p.parse::<u32>().ok()) {
                wait_pid(pid);
            }
        }
    }
}

#[cfg(windows)]
fn wait_pid(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, 30_000);
            CloseHandle(h);
        }
    }
}
#[cfg(not(windows))]
fn wait_pid(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering::*;

    #[test]
    fn versions() {
        assert_eq!(compare("v0.3.0", "0.2.0"), Greater);
        assert_eq!(compare("rs-v0.2.0", "0.2.0"), Equal);
        assert_eq!(compare("1.0.0-beta", "1.0.0"), Less);
        assert_eq!(compare("1.0.0-beta.2", "1.0.0-beta.10"), Less);
        assert_eq!(compare("1.0.0-1", "1.0.0-alpha"), Less);
        assert!(parse_version("v1.2").is_none());
    }

    #[test]
    fn picks_only_rs_release() {
        let list = json!([
            { "tag_name": "v1.4.0", "assets": [{ "name": "Cephalon.Merlin.exe", "browser_download_url": "x" }] },
            { "tag_name": "rs-v0.3.0", "body": "neu", "assets": [{ "name": "Cephalon-Merlin-RS.exe", "browser_download_url": "u", "size": 5, "digest": "sha256:ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789" }] },
            { "tag_name": "rs-v0.4.0", "prerelease": true, "assets": [{ "name": "Cephalon-Merlin-RS.exe", "browser_download_url": "p" }] }
        ]);
        let r = evaluate(&list, "0.2.0").unwrap();
        assert_eq!(r["version"], "0.3.0");
        assert_eq!(r["newer"], true);
        assert_eq!(r["asset"]["url"], "u");
        assert_eq!(r["asset"]["sha256"].as_str().unwrap().len(), 64);
        assert!(evaluate(&json!([list[0].clone()]), "0.2.0").is_none());
    }

    #[cfg(windows)]
    #[test]
    fn sha256_works() {
        assert_eq!(sha256_hex(b"abc").unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}

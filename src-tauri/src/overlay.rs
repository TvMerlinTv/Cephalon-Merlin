//! Ingame-Overlay: Bildschirm aufnehmen, per OCR auswerten, Infos über dem Spiel anzeigen.
//! Port von electron/overlay.cjs + logWatcher.cjs. Auslöser:
//!  - EE.log meldet den Belohnungs-Bildschirm -> mehrmals scannen, bis 4 Teile erkannt sind
//!  - EE.log meldet die Relikt-Auswahl -> alle 0,5 s scannen (nur wenn das Spiel vorne ist)
//!  - Scan-Taste (Standard Pos1)
//! Das Overlay-Fenster ist durchsichtig, klick-durchlässig, nimmt nie den Fokus und ist von
//! Bildschirmaufnahmen ausgeschlossen. Es klickt nie etwas im Spiel.
use crate::ocr::{self, Image, Word};
use crate::{logger, AppState};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Copy)]
struct Region {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    zoom: f64,
    mask: bool,
}
const fn region(x: f64, y: f64, w: f64, h: f64, zoom: f64) -> Region {
    Region { x, y, w, h, zoom, mask: false }
}
const FULL: [Region; 1] = [region(0.0, 0.0, 1.0, 1.0, 1.0)];
// Relikt-Auswahl: oben links "MESO ERA" + Sortierung/Suche, links das Raster, rechts die Belohnungen (2× gezoomt)
const SELECTION: [Region; 3] = [region(0.0, 0.04, 0.71, 0.135, 1.0), region(0.0, 0.17, 0.71, 0.8, 1.0), region(0.71, 0.16, 0.29, 0.7, 2.0)];

/// Das Raster wird abwechselnd unterschiedlich aufbereitet – jede Variante verliest andere Namen.
fn selection_regions(pass: usize) -> Vec<Region> {
    let mut r = SELECTION.to_vec();
    match pass % 3 {
        1 => r[1].mask = true,
        2 => r[1].zoom = 0.75,
        _ => {}
    }
    r
}

const SHOW_REWARDS: Duration = Duration::from_secs(30);
const SHOW_SELECTION: Duration = Duration::from_secs(15);
const WATCH_MS: u64 = 500;
const TILE_KEEP_MS: i64 = 60_000;
const WATCH_MAX: Duration = Duration::from_secs(15 * 60);
const RELIC_KEEP_MS: i64 = 30 * 60 * 1000;

#[derive(Default)]
struct Watch {
    active: bool,
    focused: bool,
    since: Option<Instant>,
    signature: String,
    last_seen: i64,
    pending_stop: bool,
    pass: usize,
    tile_cache: HashMap<String, Vec<Value>>,
    current: Option<Value>,
    generation: u64,
}

#[derive(Default)]
struct State {
    last: Option<Value>,
    watch: Watch,
    rects: Vec<(f64, f64, f64, f64)>,
    owned: Option<HashSet<String>>,
    scanning: bool,
    hide_gen: u64,
    hotkey: Option<String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(State::default))
}

fn now() -> i64 {
    crate::net::now_ms()
}

// ---------- Overlay-Fenster ----------
fn overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window("overlay") {
        return Some(w);
    }
    let monitor = app.primary_monitor().ok().flatten()?;
    let (pos, size, scale) = (monitor.position(), monitor.size(), monitor.scale_factor());
    let w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html#overlay".into()))
        .title("Cephalon Merlin Overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .content_protected(true)
        .position(pos.x as f64 / scale, pos.y as f64 / scale)
        .inner_size(size.width as f64 / scale, size.height as f64 / scale)
        .build()
        .map_err(|e| logger::error("overlay", format!("Fenster: {e}")))
        .ok()?;
    let _ = w.set_ignore_cursor_events(true);
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::*;
        unsafe {
            // Nie den Fokus nehmen (sonst verliert das Spiel die Eingabe)
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
        }
    }
    Some(w)
}

fn show_overlay(app: &AppHandle) {
    let Some(w) = overlay_window(app) else { return };
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::*;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        return;
    }
    let _ = w.show();
}

// Zeigen geht direkt über Windows (ohne Fokus-Klau). Deshalb auch Verstecken und Prüfen direkt über
// Windows: Tauri kennt den Zustand nicht und hielt das Fenster für schon versteckt (hide() tat nichts).
pub fn hide(app: &AppHandle) {
    let Some(w) = app.get_webview_window("overlay") else { return };
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        return;
    }
    let _ = w.hide();
}

fn overlay_visible(app: &AppHandle) -> bool {
    let Some(w) = app.get_webview_window("overlay") else { return false };
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        return unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd).as_bool() };
    }
    w.is_visible().unwrap_or(false)
}

fn schedule_hide(app: &AppHandle, after: Duration) {
    let gen = with(|s| {
        s.hide_gen += 1;
        s.hide_gen
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(after).await;
        if with(|s| s.hide_gen == gen) {
            hide(&app);
        }
    });
}

// ---------- Ergebnisse veröffentlichen ----------
fn publish(app: &AppHandle, result: Value) {
    with(|s| s.last = Some(result.clone()));
    log_rewards(app, &result);
    let _ = app.emit("scan", &result);
    let mode = result["mode"].as_str().unwrap_or("");
    if mode == "rewards" || mode == "selection" {
        show_overlay(app);
        let watching = with(|s| s.watch.active);
        if mode == "rewards" {
            schedule_hide(app, SHOW_REWARDS);
        } else if !watching {
            schedule_hide(app, SHOW_SELECTION);
        } else {
            with(|s| s.hide_gen += 1); // laufenden Ausblende-Timer abbrechen
        }
    }
}

/// Jeder echte Belohnungs-Scan landet im Belohnungs-Log (Relikt = zuletzt angeklicktes in der Auswahl).
fn log_rewards(app: &AppHandle, result: &Value) {
    if result["mode"] != "rewards" || result["reason"] == "file" {
        return;
    }
    let relic = with(|s| {
        let cur = s.watch.current.as_ref()?;
        let id = cur["relicId"].as_str()?;
        (now() - s.watch.last_seen < RELIC_KEEP_MS).then(|| json!({ "id": id, "name": cur["relicName"], "refinement": cur["refinement"] }))
    });
    let data = app.state::<AppState>().data.clone();
    match crate::rewardlog::record(&data, result, relic) {
        Ok(Some(entry)) => {
            let _ = app.emit("reward-log", &entry);
        }
        Ok(None) => {}
        Err(e) => logger::warn("overlay", format!("Belohnungs-Log: {e}")),
    }
}

// ---------- Scannen ----------
/// Scrollleiste des Rasters: Position des hellen Schiebers (gerundet) oder "none".
fn scroll_position(shot: &Image) -> String {
    let x = ((shot.width as f64 * 0.7007).round() as usize).saturating_sub(2);
    let y0 = (shot.height as f64 * 0.18).round() as usize;
    let h = ((shot.height as f64 * 0.74).round() as usize).min(shot.height.saturating_sub(y0));
    let (mut best_start, mut best_len, mut run_start, mut run_len) = (0usize, 0usize, 0usize, 0usize);
    for y in 0..h {
        let bright = (0..5).filter(|i| x + i < shot.width).filter(|i| {
            let (r, g, b) = shot.pixel(x + i, y0 + y);
            (r as u32 + g as u32 + b as u32) / 3 >= 90
        });
        if bright.count() >= 2 {
            if run_len == 0 {
                run_start = y;
            }
            run_len += 1;
            if run_len > best_len {
                (best_start, best_len) = (run_start, run_len);
            }
        } else {
            run_len = 0;
        }
    }
    if (best_len as f64) < h as f64 * 0.03 {
        return "none".into();
    }
    ((best_start as f64 / 2.0).round() as i64).to_string()
}

fn recognize_regions(shot: &Image, regions: &[Region], rects: &[(f64, f64, f64, f64)], overlay_shown: bool) -> Result<Vec<Word>, String> {
    let mut words = Vec::new();
    for r in regions {
        let (rx, ry) = ((shot.width as f64 * r.x).round(), (shot.height as f64 * r.y).round());
        let (rw, rh) = ((shot.width as f64 * r.w).round(), (shot.height as f64 * r.h).round());
        let mut img = shot.crop(rx as usize, ry as usize, rw as usize, rh as usize);
        // Sicherheitsnetz: falls das Overlay doch in der Aufnahme ist, seine Schilder schwärzen
        if overlay_shown {
            for &(bx, by, bw, bh) in rects {
                if bx < rx + rw && bx + bw > rx && by < ry + rh && by + bh > ry {
                    img.blank((bx - rx) as i64, (by - ry) as i64, (bx + bw - rx) as i64, (by + bh - ry) as i64);
                }
            }
        }
        if r.zoom != 1.0 {
            img = img.resize((img.width as f64 * r.zoom).round() as usize, (img.height as f64 * r.zoom).round() as usize);
        }
        if r.mask {
            img.text_mask();
        }
        for w in ocr::recognize(img)? {
            words.push(Word { x: w.x / r.zoom + rx, y: w.y / r.zoom + ry, w: w.w / r.zoom, h: w.h / r.zoom, ..w });
        }
    }
    Ok(words)
}

async fn run_scan(app: &AppHandle, reason: &str, regions: Vec<Region>) -> Result<Value, String> {
    let data = app.state::<AppState>().data.clone();
    let relic_db = crate::db::relics(&data, false).await?;
    let (rects, owned) = with(|s| (s.rects.clone(), s.owned.clone()));
    let shown = overlay_visible(app);
    let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let is_selection = regions.len() == SELECTION.len();
    let (words, w, h, scroll) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let shot = ocr::capture_primary()?;
        let words = recognize_regions(&shot, &regions, &rects, shown)?;
        let scroll = is_selection.then(|| scroll_position(&shot));
        Ok((words, shot.width, shot.height, scroll))
    })
    .await
    .map_err(|e| e.to_string())??;
    let relics = relic_db["relics"].as_array().cloned().unwrap_or_default();
    let mut r = crate::scan::analyze(&words, &relics, owned.as_ref());
    r["scroll"] = json!(scroll);
    r["screen"] = json!({ "width": w, "height": h, "scale": scale });
    r["reason"] = json!(reason);
    r["at"] = json!(now());
    Ok(r)
}

/// Ein Scan; läuft schon einer, kommt das letzte Ergebnis zurück. Hängt nie länger als 10 s.
async fn scan(app: &AppHandle, reason: &str, silent: bool, regions: Vec<Region>) -> Value {
    if with(|s| std::mem::replace(&mut s.scanning, true)) {
        return with(|s| s.last.clone()).unwrap_or(Value::Null);
    }
    let r = tokio::time::timeout(Duration::from_secs(10), run_scan(app, reason, regions)).await;
    with(|s| s.scanning = false);
    let msg = match r {
        Ok(Ok(result)) => {
            if !silent {
                publish(app, result.clone());
            }
            return result;
        }
        Ok(Err(e)) => e,
        Err(_) => "Scan hat zu lange gedauert".into(),
    };
    logger::warn("overlay", format!("Scan ({reason}) fehlgeschlagen: {msg}"));
    let result = json!({ "mode": "error", "error": msg, "reason": reason, "at": now() });
    let _ = app.emit("scan", &result);
    result
}

pub async fn scan_now(app: &AppHandle, reason: &str) -> Value {
    scan(app, reason, false, FULL.to_vec()).await
}

/// Screenshot-Datei auswerten (zum Testen ohne Spiel).
pub async fn scan_file(app: &AppHandle, path: std::path::PathBuf) -> Result<Value, String> {
    let data = app.state::<AppState>().data.clone();
    let relic_db = crate::db::relics(&data, false).await?;
    let (words, w, h) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let img = decode_image(&path)?;
        let (w, h) = (img.width, img.height);
        Ok((ocr::recognize(img)?, w, h))
    })
    .await
    .map_err(|e| e.to_string())??;
    let relics = relic_db["relics"].as_array().cloned().unwrap_or_default();
    let mut r = crate::scan::analyze(&words, &relics, None);
    r["screen"] = json!({ "width": w, "height": h, "scale": 1 });
    r["reason"] = json!("file");
    r["at"] = json!(now());
    with(|s| s.last = Some(r.clone()));
    let _ = app.emit("scan", &r);
    Ok(r)
}

/// PNG/JPG/BMP per Windows-Bilddecoder laden.
#[cfg(windows)]
fn decode_image(path: &std::path::Path) -> Result<Image, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, ExifOrientationMode, ColorManagementMode, BitmapTransform};
    use windows::Storage::{FileAccessMode, StorageFile};
    let e = |x: windows::core::Error| x.to_string();
    let full = std::fs::canonicalize(path).map_err(|x| x.to_string())?;
    let full = full.display().to_string().trim_start_matches(r"\\?\").to_string();
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(full)).map_err(e)?.join().map_err(e)?;
    let stream = file.OpenAsync(FileAccessMode::Read).map_err(e)?.join().map_err(e)?;
    let dec = BitmapDecoder::CreateAsync(&stream).map_err(e)?.join().map_err(e)?;
    let (w, h) = (dec.PixelWidth().map_err(e)?, dec.PixelHeight().map_err(e)?);
    let pd = dec
        .GetPixelDataTransformedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied, &BitmapTransform::new().map_err(e)?, ExifOrientationMode::IgnoreExifOrientation, ColorManagementMode::DoNotColorManage)
        .map_err(e)?
        .join()
        .map_err(e)?;
    let bytes = pd.DetachPixelData().map_err(e)?;
    Ok(Image { width: w as usize, height: h as usize, data: bytes.to_vec() })
}
#[cfg(not(windows))]
fn decode_image(_: &std::path::Path) -> Result<Image, String> {
    Err("Nur unter Windows".into())
}

// ---------- Relikt-Auswahl beobachten ----------
fn signature(s: &Value) -> String {
    let mut tiles: Vec<String> = s["tiles"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| format!("{}@{},{}", t["relicId"].as_str().unwrap_or(""), (t["x"].as_f64().unwrap_or(0.0) / 20.0).round(), (t["y"].as_f64().unwrap_or(0.0) / 20.0).round()))
        .collect();
    tiles.sort();
    let tip = match &s["tooltip"] {
        Value::Object(t) => format!("{},{}", (t["x"].as_f64().unwrap_or(0.0) / 40.0).round(), (t["y"].as_f64().unwrap_or(0.0) / 40.0).round()),
        _ => "-".into(),
    };
    format!(
        "{}|{}|{}|{}|{tip}|{}",
        s["era"],
        s["relicId"],
        s["refinement"],
        s["spots"].as_array().map(Vec::len).unwrap_or(0),
        tiles.join(";")
    )
}

fn f(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap_or(0.0)
}

/// Kacheln "klebrig" machen: Abstimmung pro Kachel; beim Scrollen alte Zahlen verwerfen.
fn merge_tiles(prev: &[Value], new: &[Value], t_now: i64) -> Vec<Value> {
    let center = |t: &Value| (f(t, "x") + f(t, "w") / 2.0, f(t, "y") + f(t, "h"));
    let near = |a: &Value, b: &Value| {
        let (p, q) = (center(a), center(b));
        (p.0 - q.0).abs() < f(a, "w").max(f(b, "w")) * 0.6 && (p.1 - q.1).abs() < f(a, "h").max(f(b, "h")) * 1.5
    };
    let fresh = |t: &Value| {
        let mut t = t.clone();
        t["seen"] = json!(t_now);
        t["votes"] = json!({ t["relicId"].as_str().unwrap_or(""): 1.0 });
        t
    };
    let mut out = Vec::new();
    let mut used = HashSet::new();
    let (mut matched, mut changed) = (0, 0);
    for t in new {
        let Some((oi, old)) = prev.iter().enumerate().find(|(_, o)| near(t, o)) else {
            out.push(fresh(t));
            continue;
        };
        used.insert(oi);
        matched += 1;
        let tid = t["relicId"].as_str().unwrap_or("").to_string();
        if old["relicId"].as_str() != Some(&tid) {
            changed += 1;
        }
        let mut votes = serde_json::Map::new();
        let old_votes = old["votes"].as_object().cloned().unwrap_or_else(|| {
            let mut m = serde_json::Map::new();
            m.insert(old["relicId"].as_str().unwrap_or("").into(), json!(1.0));
            m
        });
        for (id, n) in &old_votes {
            let n = n.as_f64().unwrap_or(0.0);
            if *id != tid && n > 0.5 {
                votes.insert(id.clone(), json!(n - 0.5));
            }
        }
        let mine = old_votes.get(&tid).and_then(Value::as_f64).unwrap_or(0.0);
        votes.insert(tid.clone(), json!((mine + 1.0).min(4.0)));
        let winner = votes.iter().max_by(|a, b| a.1.as_f64().partial_cmp(&b.1.as_f64()).unwrap()).map(|(k, _)| k.clone()).unwrap_or_default();
        let mut keep = if winner == tid { t.clone() } else { old.clone() };
        keep["seen"] = json!(t_now);
        keep["votes"] = Value::Object(votes);
        out.push(keep);
    }
    if changed >= 3 && changed as f64 >= matched as f64 * 0.5 {
        return new.iter().map(fresh).collect();
    }
    for (i, old) in prev.iter().enumerate() {
        if !used.contains(&i) && t_now - old["seen"].as_i64().unwrap_or(0) <= TILE_KEEP_MS {
            out.push(old.clone());
        }
    }
    if new.len() >= 3 {
        let rows: Vec<f64> = new.iter().map(|t| f(t, "y") + f(t, "h")).collect();
        out.retain(|t| rows.iter().any(|y| (f(t, "y") + f(t, "h") - y).abs() < f(t, "h") * 0.6));
    }
    out
}

/// Neuen Scan mit dem bisherigen Stand zusammenführen (angeklicktes Relikt wechselt nur bei sicherer Erkennung).
fn merge_selection(w: &mut Watch, prev: Option<&Value>, r: Value) -> Value {
    let empty = json!({});
    let prev = prev.unwrap_or(&empty);
    let t_now = now();
    let era = if r["era"].is_null() { prev["era"].clone() } else { r["era"].clone() };
    let pick = |a: &Value, b: &Value| if a.is_null() { b.clone() } else { a.clone() };
    let view = json!({ "sort": pick(&r["view"]["sort"], &prev["view"]["sort"]), "search": pick(&r["view"]["search"], &prev["view"]["search"]) });
    let scroll = pick(&r["scroll"], &prev["scroll"]);
    let grid_key = format!("{}|{}|{}|{}", era, view["sort"], view["search"], scroll);
    if let Some(pk) = prev["gridKey"].as_str() {
        if pk != grid_key {
            w.tile_cache.insert(pk.to_string(), prev["tiles"].as_array().cloned().unwrap_or_default());
        }
    }
    let base = if prev["gridKey"].as_str() == Some(&grid_key) {
        prev["tiles"].as_array().cloned().unwrap_or_default()
    } else {
        w.tile_cache.get(&grid_key).cloned().unwrap_or_default()
    };
    let tiles = merge_tiles(&base, r["tiles"].as_array().map(|v| v.as_slice()).unwrap_or(&[]), t_now);
    w.tile_cache.insert(grid_key.clone(), tiles.clone());
    let mut r = r;
    r["view"] = view;
    r["scroll"] = scroll;
    r["gridKey"] = json!(grid_key);
    r["era"] = era.clone();
    r["tiles"] = json!(tiles);
    let sure = !r["relicId"].is_null() && (r["rewardHits"].as_u64().unwrap_or(0) >= 2 || r["nameScore"].as_f64().unwrap_or(0.0) >= 0.9);
    if sure && r["relicId"] == prev["relicId"] && r["refinement"] == prev["refinement"] {
        // Gleiches Relikt: bisher gefundene Belohnungs-Positionen behalten und ergänzen
        let mut spots = r["spots"].as_array().cloned().unwrap_or_default();
        for s in prev["spots"].as_array().into_iter().flatten() {
            if !spots.iter().any(|x| x["name"] == s["name"]) {
                spots.push(s.clone());
            }
        }
        r["spots"] = json!(spots);
        return r;
    }
    if sure {
        return r;
    }
    if era != prev["era"] || r["noRelic"].as_bool().unwrap_or(false) {
        r["relicId"] = Value::Null;
        r["spots"] = json!([]);
        return r;
    }
    for k in ["relicId", "relicName", "refinement", "spots", "anchor", "titleLeft"] {
        r[k] = prev[k].clone();
    }
    r
}

fn load_owned(app: &AppHandle) {
    let data = app.state::<AppState>().data.clone();
    tauri::async_runtime::spawn(async move {
        let inv = crate::game::load_last(&data).await;
        let owned = inv.and_then(|i| i["relics"].as_object().map(|m| m.keys().cloned().collect::<HashSet<_>>()));
        with(|s| s.owned = owned);
    });
}

fn start_watch(app: &AppHandle) {
    load_owned(app);
    let (current, gen) = with(|s| {
        let w = &mut s.watch;
        w.active = true;
        w.focused = true;
        w.since = Some(Instant::now());
        w.last_seen = now();
        w.pending_stop = false;
        w.tile_cache.clear();
        w.generation += 1;
        // Die zuletzt gesehene Ära ist eine gute erste Schätzung (das Spiel merkt sie sich auch)
        let last_era = w.current.as_ref().map(|c| c["era"].clone()).filter(|e| !e.is_null()).or_else(|| s.last.as_ref().map(|l| l["era"].clone())).unwrap_or(Value::Null);
        let cur = json!({ "mode": "selection", "era": last_era, "relicId": null, "tiles": [], "spots": [], "reason": "open", "at": now() });
        w.signature = signature(&cur);
        w.current = Some(cur.clone());
        (cur, w.generation)
    });
    publish(app, current);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        watch_loop(app, gen).await;
    });
}

fn stop_watch(app: &AppHandle) {
    let hide_now = with(|s| {
        if !s.watch.active {
            return false;
        }
        s.watch.active = false;
        s.watch.generation += 1;
        // Ein gerade gezeigtes Belohnungs-Overlay bleibt stehen (das blendet sein eigener Timer aus)
        !s.last.as_ref().is_some_and(|l| l["mode"] == "rewards")
    });
    if hide_now {
        hide(app);
    }
}

async fn watch_loop(app: AppHandle, gen: u64) {
    let mut misses = 0;
    loop {
        let (active, focused, since, pass, pending) = with(|s| {
            let w = &mut s.watch;
            let p = w.pass;
            (w.active && w.generation == gen, w.focused, w.since, p, w.pending_stop)
        });
        if !active {
            return;
        }
        if since.is_some_and(|t| t.elapsed() > WATCH_MAX) {
            return stop_watch(&app);
        }
        let mut focused = focused;
        if !focused && ocr::foreground_process().to_lowercase().starts_with("warframe") {
            with(|s| s.watch.focused = true);
            focused = true;
        }
        if focused && !with(|s| s.scanning) {
            with(|s| s.watch.pass += 1);
            let r = scan(&app, "watch", true, selection_regions(pass)).await;
            if r["mode"] != "selection" {
                misses += 1;
                if pending || misses >= 6 {
                    return stop_watch(&app);
                }
            } else {
                misses = 0;
                let publish_now = with(|s| {
                    if s.watch.generation != gen {
                        return None;
                    }
                    s.watch.last_seen = now();
                    s.watch.pending_stop = false;
                    let prev = s.watch.current.clone();
                    let next = merge_selection(&mut s.watch, prev.as_ref(), r);
                    let sig = signature(&next);
                    s.watch.current = Some(next.clone());
                    if sig != s.watch.signature {
                        s.watch.signature = sig;
                        Some(Some(next))
                    } else {
                        Some(None)
                    }
                });
                match publish_now {
                    None => return,
                    Some(Some(next)) => publish(&app, next),
                    Some(None) => {
                        if !overlay_visible(&app) {
                            show_overlay(&app);
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(WATCH_MS)).await;
    }
}

// ---------- EE.log mitlesen (wie WFinfo) ----------
#[derive(Debug)]
enum LogEvent {
    Rewards,
    Closed,
    SelectionOpen,
    Screen(String),
    Focus(bool),
}

fn watch_log(tx: tokio::sync::mpsc::UnboundedSender<LogEvent>) {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
    let file = std::path::PathBuf::from(local).join("Warframe").join("EE.log");
    std::thread::Builder::new()
        .name("ee-log".into())
        .spawn(move || {
            use std::io::{Read, Seek, SeekFrom};
            let mut pos: Option<u64> = None;
            let mut rest = String::new();
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let Ok(meta) = std::fs::metadata(&file) else { continue };
                let size = meta.len();
                // Start oder neues Log (Spielneustart): ab dem Ende lesen
                if pos.map_or(true, |p| size < p) {
                    pos = Some(size);
                    rest.clear();
                }
                let p = pos.unwrap();
                if size == p {
                    continue;
                }
                let Ok(mut f) = std::fs::File::open(&file) else { continue };
                if f.seek(SeekFrom::Start(p)).is_err() {
                    continue;
                }
                let mut buf = Vec::with_capacity((size - p) as usize);
                let _ = f.take(size - p).read_to_end(&mut buf);
                pos = Some(p + buf.len() as u64);
                // Latin-1: jedes Byte ein Zeichen
                rest.extend(buf.iter().map(|&b| b as char));
                let mut lines: Vec<&str> = rest.split('\n').collect();
                let tail = lines.pop().unwrap_or("").to_string();
                for line in lines {
                    let ev = if line.contains("Pause countdown done") || line.contains("Got rewards") {
                        Some(LogEvent::Rewards)
                    } else if line.contains("Relic timer closed") || line.contains("MatchingService::EndSession") {
                        Some(LogEvent::Closed)
                    } else if line.contains("Created /Lotus/Interface/ThemedProjectionManager.swf") {
                        Some(LogEvent::SelectionOpen)
                    } else if line.contains("WM_ACTIVATEAPP 0") {
                        Some(LogEvent::Focus(false))
                    } else if line.contains("WM_ACTIVATEAPP 1") {
                        Some(LogEvent::Focus(true))
                    } else if let Some(i) = line.find("Subscribing for /Lotus/Interface/") {
                        let rest = &line[i + 33..];
                        let name = rest.split(".swf").next().unwrap_or("").to_string();
                        (rest.contains(".swf") && !name.starts_with("ThemedProjectionManager")).then_some(LogEvent::Screen(name))
                    } else {
                        None
                    };
                    if let Some(ev) = ev {
                        if tx.send(ev).is_err() {
                            return;
                        }
                    }
                }
                rest = tail;
            }
        })
        .ok();
}

/// Belohnungs-Bildschirm braucht einen Moment, bis alle Namen da sind – mehrmals versuchen.
async fn auto_rewards(app: AppHandle) {
    tokio::time::sleep(Duration::from_millis(1200)).await;
    for _ in 0..5 {
        if scan(&app, "auto", false, FULL.to_vec()).await["mode"] == "rewards" {
            return;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

fn setting(app: &AppHandle, key: &str) -> Value {
    app.state::<AppState>().settings.get()[key].clone()
}

// ---------- Scan-Taste ----------
pub fn register_hotkey(app: &AppHandle, key: &str) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    if let Some(old) = with(|s| s.hotkey.take()) {
        let _ = gs.unregister(old.as_str());
    }
    let handle = app.clone();
    let r = gs.on_shortcut(key, move |_app, _sc, ev| {
        if ev.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                scan_now(&h, "hotkey").await;
            });
        }
    });
    match r {
        Ok(()) => with(|s| s.hotkey = Some(key.to_string())),
        Err(e) => logger::warn("overlay", format!("Taste {key} ist schon belegt: {e}")),
    }
}

pub fn last() -> Option<Value> {
    with(|s| s.last.clone())
}

pub fn set_rects(rects: Vec<(f64, f64, f64, f64)>) {
    with(|s| s.rects = rects.into_iter().take(200).collect());
}

pub fn settings_changed(app: &AppHandle, values: &Value) {
    let hotkey = values["hotkey"].as_str().unwrap_or("Home").to_string();
    if with(|s| s.hotkey.as_deref() != Some(hotkey.as_str())) {
        register_hotkey(app, &hotkey);
    }
    if !values["selectionOverlay"].as_bool().unwrap_or(true) {
        stop_watch(app);
    }
}

/// Startet Log-Watcher, Hotkey und OCR-Thread.
pub fn setup(app: &AppHandle) {
    ocr::warm_up();
    load_owned(app);
    let key = setting(app, "hotkey").as_str().unwrap_or("Home").to_string();
    register_hotkey(app, &key);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    watch_log(tx);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                LogEvent::Rewards => {
                    stop_watch(&app);
                    if setting(&app, "rewardsOverlay").as_bool().unwrap_or(true) {
                        tauri::async_runtime::spawn(auto_rewards(app.clone()));
                    }
                }
                LogEvent::Closed => hide(&app),
                LogEvent::SelectionOpen => {
                    if setting(&app, "selectionOverlay").as_bool().unwrap_or(true) {
                        start_watch(&app);
                    }
                }
                LogEvent::Screen(name) => {
                    // Kleine Fenster über der Auswahl (Dialog, Chat, Tooltip): nur vormerken und per Scan prüfen.
                    // Jeder andere Bildschirm (z. B. MapRedux = Sternkarte): Auswahl ist zu -> sofort beenden.
                    let small = ["Dialog", "Chat", "Tooltip", "ToolTip", "Popup"].iter().any(|p| name.contains(p));
                    let active = with(|s| {
                        if s.watch.active && small {
                            s.watch.pending_stop = true;
                        }
                        s.watch.active
                    });
                    if active && !small {
                        logger::info("overlay", format!("Relikt-Auswahl verlassen ({name})"));
                        stop_watch(&app);
                    }
                }
                LogEvent::Focus(true) => {
                    let show = with(|s| {
                        s.watch.focused = true;
                        s.watch.active && s.last.as_ref().is_some_and(|l| l["mode"] == "selection")
                    });
                    if show {
                        show_overlay(&app);
                    }
                }
                LogEvent::Focus(false) => {
                    // "WM_ACTIVATEAPP 0" kommt auch bei kurz aufblitzenden Hilfsfenstern – nur bei echtem Alt-Tab ausblenden
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    let fg = ocr::foreground_process();
                    let l = fg.to_lowercase();
                    if fg.is_empty() || l.starts_with("warframe") || l.contains("cephalon merlin") {
                        continue;
                    }
                    with(|s| s.watch.focused = false);
                    hide(&app);
                }
            }
        }
    });
}

#[cfg(test)]
#[test]
#[ignore]
fn ocr_file() {
    let img = decode_image(std::path::Path::new(&std::env::var("CMRS_IMG").unwrap())).unwrap();
    let words = ocr::recognize(img).unwrap();
    println!("OCR: {}", words.iter().map(|w| w.t.as_str()).collect::<Vec<_>>().join(" "));
}

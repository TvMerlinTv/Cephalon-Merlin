//! Cephalon Merlin (Rust + Tauri 2) – Einstieg und Befehle für die Oberfläche.
mod alerts;
mod autosync;
mod clipboard;
mod updater;
mod db;
mod discord;
mod game;
mod logger;
mod net;
mod notify;
mod ocr;
mod overframe;
mod overlay;
mod paths;
mod rewardlog;
mod scan;
mod world;
mod settings;
mod store;
mod window_state;

use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub data: PathBuf,
    pub settings: settings::Settings,
}

// ---------- Einstellungen ----------
#[tauri::command]
fn settings_get(state: State<AppState>) -> Value {
    json!({ "values": state.settings.get(), "hotkeys": settings::HOTKEYS })
}

#[tauri::command]
fn settings_set(app: AppHandle, state: State<AppState>, patch: Value) -> Result<Value, String> {
    let values = state.settings.update(patch)?;
    let _ = app.emit("settings-changed", &values);
    overlay::settings_changed(&app, &values);
    // Discord-Einstellungen sofort anwenden
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        discord::retry(&a).await;
    });
    Ok(values)
}

// ---------- Item-Datenbanken ----------
#[tauri::command]
async fn mastery_db(state: State<'_, AppState>, force: Option<bool>) -> Result<Value, String> {
    db::mastery(&state.data, force.unwrap_or(false)).await
}

#[tauri::command]
async fn relic_db(state: State<'_, AppState>, force: Option<bool>) -> Result<Value, String> {
    db::relics(&state.data, force.unwrap_or(false)).await
}

#[tauri::command]
async fn bulk_prices(state: State<'_, AppState>) -> Result<Value, String> {
    db::bulk_prices(&state.data).await
}

// ---------- Overlay & Scan ----------
#[tauri::command]
async fn scan_now(app: AppHandle) -> Value {
    overlay::scan_now(&app, "button").await
}

#[tauri::command]
fn scan_last() -> Option<Value> {
    overlay::last()
}

/// Screenshot-Datei auswerten (Testen ohne Spiel).
#[tauri::command]
async fn scan_file(app: AppHandle) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Screenshot zum Testen auswählen")
        .add_filter("Bilder", &["png", "jpg", "jpeg", "bmp"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    overlay::scan_file(&app, path).await.map(Some)
}

/// Flächen, auf denen das Overlay gerade etwas zeigt (Bildschirm-Pixel) – werden vor der OCR geschwärzt.
#[tauri::command]
fn overlay_rects(rects: Vec<(f64, f64, f64, f64)>) {
    overlay::set_rects(rects);
}

#[tauri::command]
fn overlay_hide(app: AppHandle) {
    overlay::hide(&app);
}

#[tauri::command]
fn reward_log_list(state: State<AppState>) -> Value {
    json!(rewardlog::load(&state.data))
}

#[tauri::command]
fn reward_log_choose(state: State<AppState>, id: String, chosen: Option<String>) -> Result<Option<Value>, String> {
    rewardlog::set_choice(&state.data, &id, chosen)
}

#[tauri::command]
fn reward_log_remove(state: State<AppState>, id: String) -> Result<bool, String> {
    rewardlog::remove(&state.data, &id)
}

// ---------- Spieldaten ----------
#[tauri::command]
async fn game_sync(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    run_sync(&app, &state.data, None).await
}

/// Sync mit dem laufenden Spiel. Ergebnis geht an alle Fenster ("inventory-changed").
/// `auto`: Auslöser des Auto-Syncs ("mission" | "interval") – dann zusätzlich "auto-sync" mit dem Zustand.
pub async fn run_sync(app: &AppHandle, data: &std::path::Path, auto: Option<&str>) -> Result<Value, String> {
    let _ = app.emit("sync-state", "start");
    if let Some(reason) = auto {
        let _ = app.emit("auto-sync", json!({ "state": "start", "reason": reason }));
    }
    let r = game::sync(data).await;
    if let Some(reason) = auto {
        let msg = r.as_ref().err().cloned();
        let _ = app.emit("auto-sync", json!({ "state": if msg.is_some() { "error" } else { "done" }, "reason": reason, "message": msg }));
    }
    match &r {
        Ok(inv) => {
            let _ = app.emit("inventory-changed", inv);
            let _ = app.emit("sync-state", "done");
        }
        Err(e) => {
            if !e.contains("Warframe läuft nicht") {
                logger::warn("sync", e);
            }
            let _ = app.emit("sync-state", "error");
        }
    }
    r
}

#[tauri::command]
async fn game_last(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    Ok(game::load_last(&state.data).await)
}

/// inventory.json importieren (z. B. von warframe-api-helper) – Dateiauswahl im Rust-Teil.
#[tauri::command]
async fn game_import(app: AppHandle, state: State<'_, AppState>) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("inventory.json importieren")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let text = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let inv = game::import_text(&state.data, text).await?;
    let _ = app.emit("inventory-changed", &inv);
    Ok(Some(inv))
}

#[tauri::command]
async fn stats_history(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(game::stats_history(&state.data).await)
}

// ---------- warframe.market (eine gemeinsame Warteschlange) ----------
#[tauri::command]
async fn market_items(state: State<'_, AppState>, force: Option<bool>) -> Result<Value, String> {
    net::items(&state.data, force.unwrap_or(false)).await
}

#[tauri::command]
async fn market_price(state: State<'_, AppState>, slug: String, rank: Option<u32>, force: Option<bool>) -> Result<Value, String> {
    net::price(&state.data, &slug, rank.unwrap_or(0), force.unwrap_or(false)).await
}

#[tauri::command]
fn market_prices_cached(state: State<AppState>) -> Value {
    net::cached_prices(&state.data)
}

#[tauri::command]
async fn riven_meta(state: State<'_, AppState>, language: String) -> Result<Value, String> {
    net::riven_meta(&state.data, &language).await
}

#[tauri::command]
async fn riven_auctions(weapon: String, positive: Vec<String>) -> Result<Value, String> {
    net::riven_auctions(&weapon, positive).await
}

#[tauri::command]
async fn market_top_orders(slug: String, rank: Option<u32>) -> Result<Value, String> {
    net::top_orders(&slug, rank).await
}

// ---------- Preis-Alarme ----------
#[tauri::command]
fn alerts_list(state: State<AppState>) -> Value {
    json!(alerts::list(&state.data))
}

#[tauri::command]
async fn alerts_add(app: AppHandle, state: State<'_, AppState>, item: Value, kind: String, target: f64, rank: Option<i64>) -> Result<Value, String> {
    alerts::add(&app, &state.data, &item, &kind, target, rank).await
}

#[tauri::command]
async fn alerts_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    alerts::remove(&app, &state.data, &id).await;
    Ok(())
}

#[tauri::command]
async fn alerts_toggle(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    alerts::toggle(&app, &state.data, &id).await;
    Ok(())
}

#[tauri::command]
async fn alerts_check(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    alerts::check(&app, &state.data, None).await;
    Ok(())
}

/// overframe.gg-Builds (nur /api/v1/, gedrosselt und 45 min gecacht).
#[tauri::command]
async fn overframe_get(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    overframe::get(&state.data, &path).await
}

/// Weggeklickt: noch wartende Auktions-Anfragen nicht mehr senden.
#[tauri::command]
fn riven_auctions_cancel() {
    net::cancel_auctions();
}

// ---------- Weltstatus ----------
/// Letzter Weltstatus (der Rust-Teil lädt ihn jede Minute und schickt ihn als "world"-Ereignis).
#[tauri::command]
async fn world_state(state: State<'_, AppState>) -> Result<Value, String> {
    match world::latest() {
        Some(w) => Ok(w),
        None => world::fetch(&state.data).await,
    }
}

/// Hintergrund: Weltstatus jede Minute laden, alle 15 s Benachrichtigungen prüfen.
fn start_world_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_fetch: Option<std::time::Instant> = None;
        loop {
            let st = app.state::<AppState>();
            if last_fetch.map_or(true, |t| t.elapsed() >= std::time::Duration::from_secs(60)) {
                match world::fetch(&st.data).await {
                    Ok(w) => {
                        let _ = app.emit("world", &w);
                        last_fetch = Some(std::time::Instant::now());
                    }
                    Err(e) => {
                        logger::warn("world", e);
                        // nach 20 s erneut versuchen
                        last_fetch = Some(std::time::Instant::now() - std::time::Duration::from_secs(40));
                    }
                }
            }
            let s = st.settings.get();
            if let Some(w) = world::latest() {
                notify::check(&app, &st.data, &s, &w);
            }
            notify::check_foundry(&app, &st.data, &s);
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });
}

/// Benachrichtigung aus der Oberfläche (z. B. Baro-Ducats-Erinnerung).
#[tauri::command]
fn notify_send(app: AppHandle, title: String, body: String, kind: Option<String>) {
    let title: String = title.chars().take(120).collect();
    let body: String = body.chars().take(400).collect();
    match kind.as_deref() {
        Some(k @ ("baro" | "world" | "foundry" | "priceAlert")) => notify::send_kind(&app, k, &title, &body),
        _ => notify::send(&app, &title, &body),
    }
}

// ---------- Discord ----------
#[tauri::command]
fn discord_status() -> Value {
    discord::status()
}

#[tauri::command]
async fn discord_retry(app: AppHandle) -> Result<Value, String> {
    Ok(discord::retry(&app).await)
}

#[tauri::command]
fn discord_webhook(state: State<AppState>) -> Value {
    discord::webhook_info(&state.data)
}

/// Bedienfehler als { ok: false, error } statt Ausnahme (kein Eintrag im Fehlerprotokoll).
fn ok_or_error(r: Result<Value, String>, data: &std::path::Path) -> Value {
    match r {
        Ok(mut v) => {
            v["ok"] = json!(true);
            v
        }
        Err(e) => {
            let mut v = discord::webhook_info(data);
            v["ok"] = json!(false);
            v["error"] = json!(e);
            v
        }
    }
}

#[tauri::command]
fn discord_webhook_set(state: State<AppState>, url: String) -> Value {
    ok_or_error(discord::webhook_set(&state.data, &url), &state.data)
}

#[tauri::command]
async fn discord_webhook_test(state: State<'_, AppState>) -> Result<Value, String> {
    let en = state.settings.get()["language"] == "en";
    let r = discord::webhook_test(&state.data, en).await;
    Ok(ok_or_error(r, &state.data))
}

#[tauri::command]
fn discord_show_logo(state: State<AppState>) {
    if let Some(f) = discord::logo_file(&state.data) {
        let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", f.display())).spawn();
    }
}

/// Test-Benachrichtigung (Einstellungen → Benachrichtigungen).
#[tauri::command]
fn notify_test(app: AppHandle, state: State<AppState>) {
    let en = state.settings.get()["language"] == "en";
    notify::send(&app, "Cephalon Merlin", if en { "Notifications work." } else { "Benachrichtigungen funktionieren." });
}

// ---------- Datenablage ----------
#[tauri::command]
fn store_get(state: State<AppState>, key: String) -> Result<Value, String> {
    store::get(&state.data, &key)
}

#[tauri::command]
fn store_set(state: State<AppState>, key: String, value: Value) -> Result<bool, String> {
    store::set(&state.data, &key, &value).map(|_| true)
}

// ---------- Hilfe & Info ----------
#[tauri::command]
fn app_info(app: AppHandle, state: State<AppState>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "tauri": tauri::VERSION,
        "webview": tauri::webview_version().unwrap_or_default(),
        "dataDir": state.data.display().to_string(),
        "legacyDir": paths::legacy_dir().map(|d| d.display().to_string()),
        "migration": paths::last_migration(&state.data),
    })
}

/// Daten der Electron-Version erneut übernehmen (vorhandene Dateien werden vorher gesichert).
#[tauri::command]
fn migrate_again(app: AppHandle, state: State<AppState>) -> Result<Value, String> {
    let m = paths::migrate(&state.data, true)?;
    logger::info("migration", format!("erneut übernommen: {:?}", m.copied));
    // Übernommene settings.json gilt sofort
    let fresh = settings::Settings::load(&state.data).get();
    let values = state.settings.update(fresh)?;
    let _ = app.emit("settings-changed", &values);
    Ok(json!({ "from": m.from, "copied": m.copied }))
}

fn explorer(arg: &std::ffi::OsStr) {
    let _ = std::process::Command::new("explorer.exe").arg(arg).spawn();
}

#[tauri::command]
fn open_data_dir(state: State<AppState>) {
    explorer(state.data.as_os_str());
}

#[tauri::command]
fn open_log(state: State<AppState>) {
    match logger::log_file().filter(|f| f.is_file()) {
        Some(f) => {
            let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", f.display())).spawn();
        }
        None => explorer(state.data.as_os_str()),
    }
}

/// Nur https-Links zu bekannten Seiten öffnen (im Standard-Browser).
const EXTERNAL_HOSTS: [&str; 16] = [
    "www.youtube.com",
    "youtube.com",
    "youtu.be",
    "warframe.market",
    "www.warframe.com",
    "warframe.com",
    "wiki.warframe.com",
    "github.com",
    "hub.warframestat.us",
    "warframestat.us",
    "overframe.gg",
    "www.overframe.gg",
    "discord.com",
    "discord.gg",
    "support.discord.com",
    "api.warframe.com",
];

// ---------- Selbst-Update ----------
#[tauri::command]
fn update_state(app: AppHandle) -> Value {
    updater::state(&app)
}

#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Value, String> {
    Ok(updater::check(&app, true).await)
}

#[tauri::command]
async fn update_install(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    // Vor dem Neustart sichern, was sonst beim Schließen gespeichert wird
    window_state::save(&state.data);
    net::save_prices(&state.data);
    updater::install(&app).await
}

/// Text in die Zwischenablage (für das Overlay: es hat nie den Fokus, navigator.clipboard geht dort nicht).
#[tauri::command]
fn copy_text(state: State<AppState>, text: String, reason: Option<String>) -> Result<(), String> {
    if text.len() > 5000 {
        return Err("Text zu lang".into());
    }
    // Belohnungs-Infos nur, wenn die Einstellung an ist
    if reason.as_deref() == Some("rewards") && !state.settings.bool("copyRewards") {
        return Ok(());
    }
    clipboard::set_text(&text)
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let rest = url.strip_prefix("https://").ok_or("Nur https-Links")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if !EXTERNAL_HOSTS.contains(&host) || url.contains(['"', ' ', '\n', '\r']) {
        return Err("Unbekannte Seite".into());
    }
    explorer(std::ffi::OsStr::new(&url));
    Ok(())
}

/// Fehler aus der Oberfläche ins Protokoll.
#[tauri::command]
fn log_write(level: String, source: String, message: String) {
    let level = match level.as_str() {
        "error" => "ERROR",
        "warn" => "WARN",
        _ => "INFO",
    };
    let source: String = source
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ':' || *c == '-')
        .take(30)
        .collect();
    logger::write(level, &format!("ui:{source}"), &message);
}

pub fn run() {
    // Nach einem Selbst-Update: erst warten, bis die alte Version beendet ist
    updater::wait_for_previous();
    let data = paths::data_dir();
    logger::init(&data);
    logger::install_panic_hook();
    logger::info(
        "app",
        format!(
            "Start {} · Tauri {} · {}",
            env!("CARGO_PKG_VERSION"),
            tauri::VERSION,
            std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
        ),
    );
    match paths::migrate(&data, false) {
        Ok(m) if !m.copied.is_empty() => logger::info(
            "migration",
            format!("aus {} übernommen: {:?}", m.from.unwrap_or_default(), m.copied),
        ),
        Ok(_) => {}
        Err(e) => logger::error("migration", e),
    }
    let state = AppState { settings: settings::Settings::load(&data), data };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Zweiter Start: vorhandenes Fenster nach vorne holen
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .setup(|app| {
            let win = app.get_webview_window("main").expect("Hauptfenster fehlt");
            let st = app.state::<AppState>();
            net::start_price_saver(st.data.clone());
            #[cfg(windows)]
            {
                let icon = st.data.join("cache").join("app-icon.png");
                if !icon.is_file() {
                    let _ = std::fs::create_dir_all(st.data.join("cache"));
                    let _ = std::fs::write(&icon, include_bytes!("../icons/128x128.png"));
                }
                notify::register_app_id(&app.config().identifier, &icon);
            }
            start_world_loop(app.handle().clone());
            overlay::setup(app.handle());
            alerts::start(app.handle().clone());
            discord::start(app.handle().clone());
            autosync::start(app.handle().clone());
            updater::start(app.handle().clone());
            window_state::restore(&win, &st.data, st.settings.bool("secondMonitor"));
            // Die Oberfläche zeigt das Fenster, sobald sie gezeichnet ist (kein weißes Aufblitzen).
            // Falls dabei etwas schiefgeht: nach 4 s trotzdem zeigen.
            let w = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if !w.is_visible().unwrap_or(true) {
                    logger::warn("app", "Oberfläche hat sich nicht gemeldet – Fenster wird trotzdem gezeigt");
                    let _ = w.show();
                }
            });
            Ok(())
        })
        .on_window_event(|win, event| match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => window_state::track(win),
            tauri::WindowEvent::Destroyed if win.label() == "main" => {
                let data = &win.state::<AppState>().data;
                window_state::save(data);
                net::save_prices(data);
                // Ohne Hauptfenster soll auch das Overlay nicht weiterleben
                win.app_handle().exit(0);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_set,
            game_sync,
            game_last,
            game_import,
            stats_history,
            market_items,
            market_price,
            market_prices_cached,
            riven_meta,
            market_top_orders,
            overframe_get,
            alerts_list,
            alerts_add,
            alerts_remove,
            alerts_toggle,
            alerts_check,
            riven_auctions,
            riven_auctions_cancel,
            world_state,
            notify_test,
            notify_send,
            discord_status,
            discord_retry,
            discord_webhook,
            discord_webhook_set,
            discord_webhook_test,
            discord_show_logo,
            mastery_db,
            relic_db,
            bulk_prices,
            scan_now,
            scan_last,
            scan_file,
            overlay_rects,
            overlay_hide,
            reward_log_list,
            reward_log_choose,
            reward_log_remove,
            store_get,
            store_set,
            app_info,
            migrate_again,
            open_data_dir,
            open_log,
            open_external,
            update_state,
            update_check,
            update_install,
            copy_text,
            log_write
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        logger::error("app", format!("Tauri-Fehler: {e}"));
    }
}

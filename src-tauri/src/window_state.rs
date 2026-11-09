//! Fensterposition und -größe merken (window-state.json) und beim Start wiederherstellen.
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct WinState {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub maximized: bool,
}

static CURRENT: Mutex<Option<WinState>> = Mutex::new(None);
const FILE: &str = "window-state.json";

pub fn restore(win: &WebviewWindow, data: &Path, second_monitor: bool) {
    let monitors = win.available_monitors().unwrap_or_default();
    if second_monitor && monitors.len() > 1 {
        // Auf den ersten Monitor, der nicht der Hauptmonitor ist, mittig
        let primary = win.primary_monitor().ok().flatten().map(|m| *m.position());
        if let Some(m) = monitors.iter().find(|m| Some(*m.position()) != primary) {
            let size = win.outer_size().unwrap_or(PhysicalSize::new(1480, 900));
            let (mp, ms) = (m.position(), m.size());
            let x = mp.x + (ms.width as i32 - size.width as i32).max(0) / 2;
            let y = mp.y + (ms.height as i32 - size.height as i32).max(0) / 2;
            let _ = win.set_position(PhysicalPosition::new(x, y));
            return;
        }
    }
    let Some(s) = std::fs::read_to_string(data.join(FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<WinState>(&t).ok())
    else {
        return;
    };
    // Nur wiederherstellen, wenn die Titelleiste auf einem vorhandenen Monitor liegt
    let visible = monitors.iter().any(|m| {
        let (p, z) = (m.position(), m.size());
        s.x + 100 >= p.x && s.x + 100 <= p.x + z.width as i32 && s.y >= p.y && s.y + 20 <= p.y + z.height as i32
    });
    if !visible || s.w < 600 || s.h < 400 {
        return;
    }
    let _ = win.set_size(PhysicalSize::new(s.w, s.h));
    let _ = win.set_position(PhysicalPosition::new(s.x, s.y));
    if s.maximized {
        let _ = win.maximize();
    }
    if let Ok(mut cur) = CURRENT.lock() {
        *cur = Some(s);
    }
}

/// Bei Bewegen/Größenänderung aufgerufen – merkt sich nur die Werte (geschrieben wird beim Beenden).
pub fn track(win: &tauri::Window) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let Ok(mut cur) = CURRENT.lock() else { return };
    let mut s = cur.unwrap_or_default();
    s.maximized = maximized;
    if !maximized {
        if let (Ok(p), Ok(z)) = (win.outer_position(), win.outer_size()) {
            (s.x, s.y, s.w, s.h) = (p.x, p.y, z.width, z.height);
        }
    }
    *cur = Some(s);
}

pub fn save(data: &Path) {
    let Some(s) = CURRENT.lock().ok().and_then(|c| *c) else { return };
    if let Ok(t) = serde_json::to_string(&s) {
        let _ = std::fs::write(data.join(FILE), t);
    }
}

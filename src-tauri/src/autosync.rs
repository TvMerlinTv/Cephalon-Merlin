//! Automatisch mit dem Spiel synchronisieren (Einstellung „Automatisch synchronisieren“).
//! Wie electron/autoSync.cjs – zwei Auslöser, beide nur solange Warframe.x64.exe läuft und im
//! aktuellen EE.log ein „Logged in“ steht:
//!  - nach jeder Mission: EE.log wird mitgelesen (nur neue Zeilen). Missionsende =
//!      "MatchingService::EndSession"; die Rückkehr erkennt
//!      "PlayerShip.lua: Pet resource loader is done" (Orbiter) bzw. "Hub.lua: Hub session ready" (Hub).
//!    8 s danach wird synchronisiert. Kommt keine Rückkehr (z. B. Duviri), nach 2 Min. trotzdem.
//!  - alle X Minuten seit dem letzten Sync (egal ob automatisch oder von Hand).
//! Der Sync selbst ist derselbe wie beim Knopf (game::sync, gleiches Leseverfahren).
use crate::AppState;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager};

const POLL: Duration = Duration::from_secs(2);
const TICK: Duration = Duration::from_secs(60);
const AFTER_MISSION: Duration = Duration::from_secs(8);
const FALLBACK: Duration = Duration::from_secs(120);

const END_SESSION: &str = "MatchingService::EndSession";
const BACK_HOME: [&str; 2] = ["PlayerShip.lua: Pet resource loader is done", "Hub.lua: Hub session ready"];
const LOGGED_IN: &str = "Sys [Info]: Logged in ";

fn ee_log() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Warframe").join("EE.log"))
}

/// Zustand des Mitlesens und der Auslöser.
#[derive(Default)]
struct Tail {
    pos: Option<u64>,
    born: Option<SystemTime>,
    rest: String,
    logged_in: bool,
    /// EndSession gesehen, Rückkehr steht noch aus (Zeitpunkt für den 2-Min.-Ersatz)
    ended: Option<Instant>,
    /// geplanter Sync nach einer Mission
    pending: Option<Instant>,
}

impl Tail {
    fn reset(&mut self, logged_in: bool) {
        self.logged_in = logged_in;
        self.ended = None;
        self.pending = None;
        self.rest.clear();
    }

    fn line(&mut self, line: &str, now: Instant) {
        if line.contains(LOGGED_IN) {
            self.logged_in = true;
        } else if line.contains(END_SESSION) {
            self.ended = Some(now);
        } else if self.ended.is_some() && BACK_HOME.iter().any(|p| line.contains(p)) {
            self.ended = None;
            self.pending = Some(now + AFTER_MISSION);
        }
    }

    /// Neue Zeilen lesen. Beim ersten Mal bzw. nach einem Spielneustart (Datei kleiner/neu)
    /// wird der bisherige Inhalt nur auf „Logged in“ geprüft.
    fn poll(&mut self, file: &PathBuf) {
        let Ok(meta) = std::fs::metadata(file) else { return };
        let size = meta.len();
        let born = meta.created().ok();
        let now = Instant::now();
        let Some(pos) = self.pos else {
            self.pos = Some(size);
            self.born = born;
            let all = read_range(file, 0, size);
            self.reset(all.contains(LOGGED_IN));
            return;
        };
        let mut start = pos;
        if size < pos || born != self.born {
            // Spiel neu gestartet: EE.log wurde neu angelegt -> von vorn lesen
            self.born = born;
            start = 0;
            self.reset(false);
        }
        if size == start {
            self.pos = Some(size);
            return;
        }
        self.pos = Some(size);
        let data = std::mem::take(&mut self.rest) + &read_range(file, start, size);
        let mut lines: Vec<&str> = data.split('\n').collect();
        let rest = lines.pop().unwrap_or("").to_string();
        for l in lines {
            self.line(l.trim_end_matches('\r'), now);
        }
        self.rest = rest;
    }
}

/// EE.log ist Latin-1: jedes Byte ein Zeichen.
fn read_range(file: &PathBuf, start: u64, end: u64) -> String {
    let Ok(mut f) = std::fs::File::open(file) else { return String::new() };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.take(end.saturating_sub(start)).read_to_end(&mut buf);
    buf.iter().map(|&b| b as char).collect()
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let file = ee_log();
        let mut tail = Tail::default();
        let mut was_on = false;
        let mut last_tick = Instant::now();
        loop {
            tokio::time::sleep(POLL).await;
            let s = app.state::<AppState>().settings.get();
            let on = s["autoSync"].as_bool().unwrap_or(false);
            if !on {
                if was_on {
                    tail = Tail::default();
                }
                was_on = false;
                continue;
            }
            if !was_on {
                // Gerade eingeschaltet: Intervall zählt ab jetzt
                crate::game::note_sync();
                was_on = true;
            }
            let Some(file) = &file else { continue };
            let mission = s["autoSyncMission"].as_bool().unwrap_or(true);
            let now = Instant::now();
            let mut reason = None;
            if mission {
                tail.poll(file);
                if tail.ended.is_some_and(|t| now >= t + FALLBACK) {
                    tail.ended = None;
                    tail.pending = Some(now);
                }
                if tail.pending.is_some_and(|t| now >= t) {
                    tail.pending = None;
                    reason = Some("mission");
                }
            } else if tail.pos.is_some() {
                tail = Tail::default();
            }
            let minutes = s["autoSyncMinutes"].as_i64().unwrap_or(0);
            if reason.is_none() && minutes > 0 && now >= last_tick + TICK {
                last_tick = now;
                if crate::game::ms_since_sync() >= minutes * 60_000 {
                    if !mission {
                        // Ohne Mitlesen den Login-Zustand einmal direkt aus EE.log holen
                        let size = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
                        tail.logged_in = read_range(file, 0, size).contains(LOGGED_IN);
                    }
                    reason = Some("interval");
                }
            }
            let Some(reason) = reason else { continue };
            if !tail.logged_in {
                continue;
            }
            if !tauri::async_runtime::spawn_blocking(crate::game::reader::game_running).await.unwrap_or(false) {
                tail.logged_in = false; // Spiel beendet – erst nach neuem Login wieder
                continue;
            }
            crate::logger::info("autosync", format!("Sync ({reason})"));
            let data = app.state::<AppState>().data.clone();
            let _ = crate::run_sync(&app, &data, Some(reason)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mission_end_then_home() {
        let mut t = Tail::default();
        let now = Instant::now();
        t.line("12.3 Sys [Info]: Logged in TestTenno (abc)", now);
        assert!(t.logged_in);
        t.line("50.0 Net [Info]: MatchingService::EndSession", now);
        assert!(t.ended.is_some() && t.pending.is_none());
        t.line("60.0 Script [Info]: PlayerShip.lua: Pet resource loader is done; spawning pets...", now);
        assert!(t.ended.is_none());
        assert_eq!(t.pending, Some(now + AFTER_MISSION));
    }

    #[test]
    fn home_without_mission_does_nothing() {
        let mut t = Tail::default();
        t.line("Script [Info]: Hub.lua: Hub session ready", Instant::now());
        assert!(t.pending.is_none());
    }
}

//! Automatisch mit dem Spiel synchronisieren (Einstellung „Automatisch synchronisieren“).
//! Wie electron/autoSync.cjs – zwei Auslöser, beide nur solange Warframe.x64.exe läuft und im
//! aktuellen EE.log ein „Logged in“ steht:
//!  - nach jeder Mission: EE.log wird mitgelesen (nur neue Zeilen). Missionsende =
//!    "MatchingService::EndSession"; die Rückkehr erkennt
//!    "PlayerShip.lua: Pet resource loader is done" (Orbiter) bzw. "Hub.lua: Hub session ready" (Hub).
//!    8 s danach wird synchronisiert. Kommt keine Rückkehr (z. B. Duviri), nach 2 Min. trotzdem.
//!  - alle X Minuten seit dem letzten Sync (egal ob automatisch oder von Hand).
//!
//! Der Sync selbst ist derselbe wie beim Knopf (game::sync, gleiches Leseverfahren).
use crate::eelog::Event;
use crate::AppState;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const TICK: Duration = Duration::from_secs(2);
const INTERVAL_CHECK: Duration = Duration::from_secs(60);
const AFTER_MISSION: Duration = Duration::from_secs(8);
const FALLBACK: Duration = Duration::from_secs(120);

const END_SESSION: &str = "MatchingService::EndSession";
const BACK_HOME: [&str; 2] = ["PlayerShip.lua: Pet resource loader is done", "Hub.lua: Hub session ready"];
const LOGGED_IN: &str = "Sys [Info]: Logged in ";

/// Login-Zustand und Auslöser (die Zeilen kommen vom gemeinsamen Leser in eelog.rs).
#[derive(Default)]
struct Tail {
    logged_in: bool,
    /// EndSession gesehen, Rückkehr steht noch aus (Zeitpunkt für den 2-Min.-Ersatz)
    ended: Option<Instant>,
    /// geplanter Sync nach einer Mission
    pending: Option<Instant>,
}

impl Tail {
    /// Erstes Lesen oder Spielneustart: nur prüfen, ob im bisherigen Log schon ein Login steht.
    fn reset(&mut self, text: &str) {
        self.logged_in = text.contains(LOGGED_IN);
        self.ended = None;
        self.pending = None;
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
}

pub fn start(app: AppHandle) {
    // Sofort abonnieren (vor eelog::start), sonst fehlt der Stand beim App-Start
    let mut rx = crate::eelog::subscribe();
    tauri::async_runtime::spawn(async move {
        let mut tail = Tail::default();
        let mut was_on = false;
        let mut last_check = Instant::now();
        loop {
            let ev = tokio::select! {
                ev = crate::eelog::recv(&mut rx) => ev,
                _ = tokio::time::sleep(TICK) => None,
            };
            let s = app.state::<AppState>().settings.get();
            let on = s["autoSync"].as_bool().unwrap_or(false);
            let mission = on && s["autoSyncMission"].as_bool().unwrap_or(true);
            let now = Instant::now();
            // Login immer mitverfolgen, Missionsende nur, wenn der Auslöser an ist
            match ev.as_deref() {
                Some(Event::Reset(text)) => tail.reset(text),
                Some(Event::Lines(lines)) => {
                    for l in lines {
                        tail.line(l, now);
                    }
                    if !mission {
                        tail.ended = None;
                        tail.pending = None;
                    }
                }
                None => {}
            }
            if !on {
                was_on = false;
                continue;
            }
            if !was_on {
                // Gerade eingeschaltet: Intervall zählt ab jetzt
                crate::game::note_sync();
                was_on = true;
            }
            let mut reason = None;
            if tail.ended.is_some_and(|t| now >= t + FALLBACK) {
                tail.ended = None;
                tail.pending = Some(now);
            }
            if tail.pending.is_some_and(|t| now >= t) {
                tail.pending = None;
                reason = Some("mission");
            }
            let minutes = s["autoSyncMinutes"].as_i64().unwrap_or(0);
            if reason.is_none() && minutes > 0 && now >= last_check + INTERVAL_CHECK {
                last_check = now;
                if crate::game::ms_since_sync() >= minutes * 60_000 {
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

#[cfg(test)]
mod reset_tests {
    use super::*;

    #[test]
    fn reset_reads_login_from_existing_log() {
        let mut t = Tail { ended: Some(Instant::now()), ..Default::default() };
        t.reset("1.0 Sys [Info]: Logged in TestTenno (abc)\n2.0 Net [Info]: x\n");
        assert!(t.logged_in);
        assert!(t.ended.is_none());
        t.reset("neues Log ohne Login\n");
        assert!(!t.logged_in);
    }
}

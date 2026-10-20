// Automatisches Synchronisieren mit dem Spiel (Einstellungen „Automatisch synchronisieren“).
//
// Zwei Auslöser, beide nur solange Warframe.x64.exe läuft und im aktuellen EE.log ein
// „Logged in“ steht:
//  - nach jeder Mission: EE.log wird mitgelesen (nur neue Zeilen). Missionsende =
//      "Net [Info]: MatchingService::EndSession"      -> Sitzung (Mission/Hub) ist vorbei
//    danach ist der Ladebildschirm zu Ende, sobald eine dieser Zeilen kommt:
//      "Script [Info]: PlayerShip.lua: Pet resource loader is done; spawning pets..."  (zurück im Orbiter)
//      "Script [Info]: Hub.lua: Hub session ready"                                     (zurück in Cetus/Fortuna/Relais …)
//    Kurz danach wird synchronisiert. Kommt keine der Zeilen (z. B. Duviri), nach 2 Min. trotzdem.
//  - alle X Minuten (seit dem letzten Sync, egal ob automatisch oder von Hand).
//
// Der Sync selbst ist syncFromGame() – der Token bleibt dort (nie gespeichert, nie an die Fenster).
// Die Fenster bekommen nur Zustand + fertige Inventar-Zusammenfassung über "game:auto-sync".
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { BrowserWindow } = require('electron');
const { syncFromGame } = require('./game.cjs');
const settings = require('./settings.cjs');

const POLL_MS = 2000; // EE.log auf neue Zeilen prüfen
const TICK_MS = 60_000; // Intervall-Modus prüfen
const AFTER_MISSION_MS = 8000; // Verzögerung nach dem Ende des Ladebildschirms
const FALLBACK_MS = 120_000; // Missionsende ohne erkennbare Rückkehr

const END_SESSION = 'MatchingService::EndSession';
const BACK_HOME = ['PlayerShip.lua: Pet resource loader is done', 'Hub.lua: Hub session ready'];
const LOGGED_IN = /Sys \[Info\]: Logged in /;

/** Prüft, ob Warframe läuft (tasklist ist billig, kein Speicherzugriff). */
function isGameRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq Warframe.x64.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 10_000 },
      (err, stdout) => resolve(!err && /"Warframe\.x64\.exe"/i.test(String(stdout))),
    );
  });
}

/**
 * Liest EE.log mit. Ruft onLine(line) für jede neue Zeile auf; beim ersten Lesen bzw. nach
 * einem Spielneustart (Datei kleiner/neu) wird der vorhandene Inhalt nur auf „Logged in“ geprüft.
 */
function tailLog(file, { onLine, onReset }) {
  let pos = null;
  let born = 0;
  let rest = '';
  let busy = false;

  const read = (start, end, cb) => {
    let data = '';
    fs.createReadStream(file, { start, end: end - 1, encoding: 'latin1' })
      .on('data', (c) => (data += c))
      .on('error', () => cb(''))
      .on('end', () => cb(data));
  };

  const tick = () => {
    if (busy) return;
    fs.stat(file, (err, st) => {
      if (err) return;
      if (pos === null) {
        // Start der App: bisherigen Inhalt nur nach dem Login-Zustand durchsuchen
        busy = true;
        born = st.birthtimeMs;
        pos = st.size;
        return read(0, st.size, (data) => {
          busy = false;
          onReset(LOGGED_IN.test(data));
        });
      }
      if (st.size < pos || st.birthtimeMs !== born) {
        // Spiel neu gestartet: EE.log wurde neu geschrieben -> von vorn lesen
        born = st.birthtimeMs;
        pos = 0;
        rest = '';
        onReset(false);
      }
      if (st.size === pos) return;
      busy = true;
      const start = pos;
      pos = st.size;
      read(start, st.size, (data) => {
        busy = false;
        const lines = (rest + data).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) onLine(line);
      });
    });
  };

  const id = setInterval(tick, POLL_MS);
  tick();
  return () => clearInterval(id);
}

function setupAutoSync({ dataDir }) {
  const local = process.env.LOCALAPPDATA;
  const logFile = local ? path.join(local, 'Warframe', 'EE.log') : null;

  let loggedIn = false;
  let missionEnded = false; // EndSession gesehen, Rückkehr steht noch aus
  let lastSync = Date.now(); // Intervall zählt ab App-Start bzw. letztem Sync
  let pending = null; // geplanter Sync nach einer Mission
  let fallback = null;
  let stopTail = null;
  let interval = null;

  const send = (payload) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('game:auto-sync', payload);
  };

  const clearTimers = () => {
    clearTimeout(pending);
    clearTimeout(fallback);
    pending = fallback = null;
  };

  async function run(reason) {
    const s = settings.get();
    if (!s.autoSync || !loggedIn) return;
    if (!(await isGameRunning())) {
      loggedIn = false; // Spiel beendet – erst nach neuem Login wieder
      return;
    }
    lastSync = Date.now();
    send({ state: 'start', reason });
    try {
      const inventory = await syncFromGame(dataDir()); // hängt sich an einen laufenden Sync an
      lastSync = Date.now();
      send({ state: 'done', reason, inventory });
    } catch (e) {
      send({ state: 'error', reason, message: e?.message ?? String(e) });
    }
  }

  // Manuelle Syncs setzen den Intervall-Zähler ebenfalls zurück
  const noteSync = () => (lastSync = Date.now());

  const scheduleAfterMission = (delay) => {
    clearTimers();
    missionEnded = false;
    pending = setTimeout(() => {
      pending = null;
      run('mission');
    }, delay);
  };

  const onLine = (line) => {
    if (LOGGED_IN.test(line)) loggedIn = true;
    else if (line.includes(END_SESSION)) {
      missionEnded = true;
      clearTimeout(fallback);
      fallback = setTimeout(() => missionEnded && scheduleAfterMission(0), FALLBACK_MS);
    } else if (missionEnded && BACK_HOME.some((p) => line.includes(p))) {
      scheduleAfterMission(AFTER_MISSION_MS);
    }
  };

  const onReset = (inLog) => {
    loggedIn = inLog;
    missionEnded = false;
    clearTimers();
  };

  function apply() {
    const s = settings.get();
    const wantTail = s.autoSync && s.autoSyncMission && !!logFile;
    if (wantTail && !stopTail) stopTail = tailLog(logFile, { onLine, onReset });
    if (!wantTail && stopTail) {
      stopTail();
      stopTail = null;
      missionEnded = false;
      clearTimers();
    }
    const wantInterval = s.autoSync && s.autoSyncMinutes > 0;
    if (wantInterval && !interval) {
      interval = setInterval(async () => {
        const m = settings.get().autoSyncMinutes;
        if (!m || Date.now() - lastSync < m * 60_000) return;
        // Ohne Log-Mitlesen den Login-Zustand einmal direkt aus EE.log holen
        if (!stopTail) loggedIn = !!logFile && LOGGED_IN.test(await fs.promises.readFile(logFile, 'latin1').catch(() => ''));
        run('interval');
      }, TICK_MS);
    }
    if (!wantInterval && interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  settings.onChange((next, prev) => {
    if (next.autoSync !== prev.autoSync || next.autoSyncMission !== prev.autoSyncMission || next.autoSyncMinutes !== prev.autoSyncMinutes) {
      if (next.autoSync && !prev.autoSync) lastSync = Date.now();
      apply();
    }
  });
  apply();

  return { noteSync };
}

module.exports = { setupAutoSync, isGameRunning };

// Fehlerprotokoll im Datenordner (logs\cephalon-merlin.log), damit sich Probleme später nachvollziehen lassen.
// Erfasst: Fehler/Warnungen des Hauptprozesses, fehlgeschlagene IPC-Aufrufe, Konsolenfehler der Fenster,
// abgestürzte Renderer. Ab 1 MB wird die Datei nach *.old.log verschoben (eine Generation).
const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const util = require('node:util');

const MAX_BYTES = 1024 * 1024;
const logDir = () => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'cephalon-merlin.log');

// Gleiche Meldung nicht hundertfach hintereinander (z. B. Netz weg und Abfrage jede Minute)
let lastLine = '';
let repeats = 0;

function write(level, source, msg) {
  const text = String(msg).replace(/\s+$/, '').slice(0, 4000);
  const key = `${level}|${source}|${text}`;
  if (key === lastLine) {
    repeats++;
    return;
  }
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = logFile();
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
    } catch {
      /* Datei gibt es noch nicht */
    }
    const prefix = repeats ? `${new Date().toISOString()}  ${'INFO'.padEnd(5)} [log] vorherige Meldung ${repeats}× wiederholt\n` : '';
    fs.appendFileSync(file, `${prefix}${new Date().toISOString()}  ${level.padEnd(5)} [${source}] ${text}\n`, 'utf8');
  } catch {
    /* Protokollieren darf die App nie stören */
  }
  lastLine = key;
  repeats = 0;
}

const fmt = (args) => args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : util.inspect(a, { depth: 3 }))).join(' ');

// Einige Meldungen sind erwartbar und kein Fehler der App
const EXPECTED = [/Warframe läuft nicht/, /Warframe is not running/i];

function setupLog() {
  write('INFO', 'app', `Start ${app.getVersion()} · Electron ${process.versions.electron} · ${process.execPath}`);

  for (const [name, level] of [['error', 'ERROR'], ['warn', 'WARN']]) {
    const orig = console[name].bind(console);
    console[name] = (...args) => {
      orig(...args);
      write(level, 'main', fmt(args));
    };
  }
  process.on('uncaughtException', (e) => write('ERROR', 'main', `Unbehandelter Fehler: ${fmt([e])}`));
  process.on('unhandledRejection', (e) => write('ERROR', 'main', `Unbehandeltes Promise: ${fmt([e])}`));

  // Fehler in IPC-Handlern landen sonst nur im Fenster – und werden dort oft still abgefangen
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) =>
    handle(channel, async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        const msg = e?.message ?? String(e);
        if (!EXPECTED.some((r) => r.test(msg))) write('ERROR', `ipc:${channel}`, fmt([e]));
        throw e;
      }
    });

  app.on('web-contents-created', (_e, wc) => {
    const src = () => (wc.getURL().includes('overlay') ? 'overlay' : 'fenster');
    // level: 0 verbose, 1 info, 2 warning, 3 error
    wc.on('console-message', (_ev, level, message, line, sourceId) => {
      if (level < 2) return;
      write(level === 3 ? 'ERROR' : 'WARN', src(), `${message}${sourceId ? ` (${path.basename(sourceId)}:${line})` : ''}`);
    });
    wc.on('preload-error', (_ev, file, err) => write('ERROR', src(), `Preload ${path.basename(file)}: ${fmt([err])}`));
    wc.on('render-process-gone', (_ev, d) => write('ERROR', src(), `Renderer beendet: ${d.reason} (Code ${d.exitCode})`));
    wc.on('unresponsive', () => write('WARN', src(), 'Fenster reagiert nicht'));
    wc.on('did-fail-load', (_ev, code, desc, url) => code !== -3 && write('ERROR', src(), `Laden fehlgeschlagen: ${desc} (${code}) ${url}`));
  });
  app.on('child-process-gone', (_e, d) => d.reason !== 'clean-exit' && write('ERROR', 'app', `Prozess ${d.type} beendet: ${d.reason} (Code ${d.exitCode})`));
}

module.exports = { setupLog, logFile, write };

// Kleine Updates: neuerer App-Code (dist/, electron/, package.json) liegt im Datenordner unter
//   %APPDATA%\Cephalon Merlin\app\<version>\
// und wird beim Start statt des Codes in der .exe geladen (siehe boot.cjs). Die .exe selbst
// (Electron-Laufzeit) bleibt gleich – nur wenn eine neue Electron-Version nötig ist, kommt die ganze .exe.
//
// Sicherheitsnetz: Ein neuer Code-Stand gilt erst als „gut“, wenn das Hauptfenster einmal geladen hat.
// Scheitert der Start zweimal, nimmt der Startlader wieder den Code aus der .exe.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MAX_TRIES = 2;
const REQUIRED = ['package.json', 'electron/main.cjs', 'electron/preload.cjs', 'dist/index.html'];

/** Ordner für die Code-Pakete im Datenordner. */
const rootDir = (userData) => path.join(userData, 'app');
const stateFile = (root) => path.join(root, 'state.json');

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));
  } catch {
    return {};
  }
}
const writeState = (root, state) => fs.writeFileSync(stateFile(root), JSON.stringify(state, null, 2));

/** Versionsvergleich (aus updater.cjs übernommen, hier ohne Electron-Abhängigkeit). */
function cmp(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Alle Versions-Ordner außer `keep` entfernen (z. B. nach einem Wechsel). */
function cleanup(root, keep) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root)) {
    if (entry === 'state.json' || entry === keep) continue;
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

/**
 * Welcher Code soll starten? Gibt { dir, version } für ein installiertes Paket zurück
 * oder null für den Code in der .exe. Zählt dabei Startversuche mit.
 */
function choose(root, bundledVersion, electronVersion) {
  const state = readState(root);
  if (!state.version) return null;
  const dir = path.join(root, state.version);
  try {
    // Die .exe ist mindestens so neu (z. B. nach einem großen Update) → Paket ist überholt
    if (cmp(state.version, bundledVersion) <= 0) {
      fs.rmSync(root, { recursive: true, force: true });
      return null;
    }
    if (state.electron !== electronVersion) return null; // passt nicht zur Laufzeit in dieser .exe
    if (!REQUIRED.every((f) => fs.existsSync(path.join(dir, f)))) return null;
    if (!state.confirmed) {
      if ((state.tries ?? 0) >= MAX_TRIES) {
        if (state.failed !== state.version) writeState(root, { ...state, failed: state.version });
        return null;
      }
      writeState(root, { ...state, tries: (state.tries ?? 0) + 1 });
    }
    cleanup(root, state.version);
    return { dir, version: state.version };
  } catch {
    return null;
  }
}

/** Nach dem ersten erfolgreichen Laden des Fensters: Paket gilt als gut. */
function confirm(root, version) {
  const state = readState(root);
  if (state.version === version && !state.confirmed) writeState(root, { ...state, confirmed: true, tries: 0 });
}

/** Version, deren Start zweimal gescheitert ist (dafür dann lieber die ganze .exe laden). */
const failedVersion = (root) => readState(root).failed ?? null;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Code-Paket bauen: { format, version, electron, files: { "dist/index.html": base64, … } } → gzip. */
function buildPack({ version, electron, files }) {
  const out = {};
  for (const [rel, buf] of Object.entries(files)) out[rel.replace(/\\/g, '/')] = buf.toString('base64');
  return zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, version, electron, files: out })), { level: 9 });
}

/** Paket prüfen und unter root/<version> ablegen. Ersetzt den Stand erst, wenn alles geschrieben ist. */
function installPack(root, gz, expect) {
  const pack = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  if (pack.format !== 1 || pack.version !== expect.version || pack.electron !== expect.electron) {
    throw new Error('Update-Paket passt nicht zu dieser Version');
  }
  const names = Object.keys(pack.files ?? {});
  for (const f of REQUIRED) if (!names.includes(f)) throw new Error(`Update-Paket unvollständig (${f} fehlt)`);
  for (const f of names) {
    if (path.isAbsolute(f) || f.split('/').includes('..')) throw new Error('Update-Paket enthält ungültige Pfade');
  }
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `${pack.version}.tmp`);
  const dir = path.join(root, pack.version);
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of names) {
    const to = path.join(tmp, ...f.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, Buffer.from(pack.files[f], 'base64'));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  writeState(root, { version: pack.version, electron: pack.electron, confirmed: false, tries: 0 });
  return dir;
}

module.exports = { rootDir, choose, confirm, failedVersion, buildPack, installPack, sha256, cleanup, MAX_TRIES };

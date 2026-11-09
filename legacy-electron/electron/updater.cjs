// Selbst-Update der portablen .exe über GitHub-Releases.
// electron-updater kann das portable Target nicht, daher eigene kleine Lösung:
//   1. GET https://api.github.com/repos/<updateRepo>/releases/latest (ohne Token)
//   2. tag_name ("v0.2.0") mit app.getVersion() vergleichen, Asset „Cephalon Merlin.exe“ suchen
//   3. Asset neben die laufende .exe laden (*.update.tmp)
//   4. Verstecktes PowerShell-Skript wartet, bis die App beendet ist, ersetzt die .exe und startet sie neu
// Aktiv nur in der echten portablen .exe (PORTABLE_EXECUTABLE_FILE), nicht in Preview/Dev.
// "updateRepo" in package.json leer = Update-Prüfung aus (still, ohne Fehler).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ASSET_NAME = 'Cephalon Merlin.exe';
const PACK_NAME = 'app-update.gz'; // kleines Update: nur App-Code
const PACK_MANIFEST = 'app-update.json'; // { version, electron, size, sha256 }
const FIRST_CHECK_MS = 15_000; // nach dem Start kurz warten, damit der Start nicht gebremst wird
const INTERVAL_MS = 6 * 60 * 60 * 1000; // danach alle 6 Stunden

// ---------- reine Helfer (ohne Electron, getestet in build/test-updater.cjs) ----------

/** "v0.2.0" / "0.2.0-beta.1" → { core: [0,2,0], pre: ['beta', 1] } oder null */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Semver-Vergleich: < 0 wenn a älter als b, 0 gleich, > 0 neuer. Ungültige Versionen zählen als 0.0.0. */
function compareVersions(a, b) {
  const pa = parseVersion(a) ?? { core: [0, 0, 0], pre: [] };
  const pb = parseVersion(b) ?? { core: [0, 0, 0], pre: [] };
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  // Vorabversion ist älter als die fertige: 1.0.0-beta < 1.0.0
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1; // Zahlen vor Text
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Passendes .exe-Asset eines Releases. GitHub ersetzt Leerzeichen im Namen durch Punkte („Cephalon.Merlin.exe“). */
function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets.filter((a) => a && typeof a.name === 'string' && a.browser_download_url) : [];
  const norm = (n) => n.toLowerCase().replace(/[\s._-]+/g, '');
  const want = norm(ASSET_NAME);
  const exact = list.find((a) => norm(a.name) === want);
  if (exact) return exact;
  const exes = list.filter((a) => a.name.toLowerCase().endsWith('.exe'));
  return exes.length === 1 ? exes[0] : null; // nur raten, wenn es eindeutig ist
}

/** Wertet die Antwort von /releases/latest aus. */
function evaluateRelease(release, currentVersion) {
  const version = String(release?.tag_name ?? '').replace(/^v/i, '');
  if (!parseVersion(version)) throw new Error(`Unbekanntes Versionsformat: ${release?.tag_name ?? '—'}`);
  const asset = pickAsset(release.assets);
  // Kleines Update: nur App-Code (appOverlay.cjs), Beschreibung in app-update.json
  const byName = (n) => (Array.isArray(release.assets) ? release.assets : []).find((a) => a?.name === n && a.browser_download_url);
  const man = byName(PACK_MANIFEST);
  const gz = byName(PACK_NAME);
  return {
    pack: man && gz ? { manifestUrl: man.browser_download_url, url: gz.browser_download_url, size: gz.size } : null,
    version,
    newer: compareVersions(version, currentVersion) > 0,
    name: release.name || `v${version}`,
    notes: String(release.body ?? '').slice(0, 20_000),
    url: release.html_url,
    publishedAt: release.published_at,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
  };
}

/** Text für ein PowerShell-Literal in einfachen Anführungszeichen. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Hilfsskript: wartet auf das Ende der App, ersetzt (mit tmpFile) die .exe und startet sie neu.
 * Ohne tmpFile nur Neustart – für kleine Updates, deren Code schon im Datenordner liegt.
 */
function buildSwapScript({ pid, tmpFile, exeFile, logFile }) {
  const swap = !!tmpFile;
  return [
    '# Cephalon Merlin – Update einspielen (automatisch erzeugt)',
    "$ErrorActionPreference = 'Stop'",
    `$appPid = ${Number(pid)}`,
    `$src = ${swap ? psQuote(tmpFile) : '$null'}`,
    `$dst = ${psQuote(exeFile)}`,
    `$log = ${psQuote(logFile)}`,
    'function Log($m) { try { Add-Content -LiteralPath $log -Value ("{0:s}  {1}" -f (Get-Date), $m) -Encoding UTF8 } catch {} }',
    'Log "Warte auf das Ende von Prozess $appPid"',
    'try { Wait-Process -Id $appPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}',
    // Die portable .exe ist ein Starter, der nach dem Ende der App noch aufräumt – erst danach neu starten.
    'for ($i = 0; $i -lt 120; $i++) {',
    '  $starter = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $dst }',
    '  if (-not $starter) { break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'if ($src) {',
    '  $ok = $false',
    '  for ($i = 0; $i -lt 120; $i++) {',
    '    try { Move-Item -LiteralPath $src -Destination $dst -Force; $ok = $true; break }',
    '    catch { Start-Sleep -Milliseconds 500 }',
    '  }',
    '  if ($ok) { Log "Update eingespielt: $dst" } else { Log "Ersetzen fehlgeschlagen – alte Version bleibt"; Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue }',
    '} else { Log "Kleines Update – starte neu" }',
    'try { Start-Process -FilePath $dst -WorkingDirectory (Split-Path -LiteralPath $dst) } catch { Log "Neustart fehlgeschlagen: $_" }',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue',
    '',
  ].join('\r\n');
}

// ---------- Electron-Teil ----------

function readRepo() {
  try {
    const repo = String(require('../package.json').updateRepo ?? '').trim();
    return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '';
  } catch {
    return '';
  }
}

const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
// Preview („Cephalon Merlin Preview.exe“) und Dev haben kein PORTABLE_EXECUTABLE_FILE – zur Sicherheit doppelt prüfen
const isPortable = () => app.isPackaged && !!portableExe() && !/preview/i.test(path.basename(process.execPath));

let state = { status: 'idle' }; // idle | off | checking | none | available | downloading | installing | error
let busy = null;

function setState(patch) {
  state = { ...state, ...patch };
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', publicState());
}

function publicState() {
  return {
    ...state,
    current: app.getVersion(),
    repo: readRepo(),
    canInstall: isPortable(),
  };
}

async function check({ manual = false } = {}) {
  const repo = readRepo();
  if (!repo) {
    setState({ status: 'off', latest: null, error: null });
    return publicState();
  }
  if (['downloading', 'installing'].includes(state.status)) return publicState();
  if (busy) return busy;
  busy = (async () => {
    // Automatische Prüfung im Hintergrund zeigt keinen Lade-Zustand
    if (manual) setState({ status: 'checking', error: null });
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CephalonMerlin/${app.getVersion()}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(20_000),
      });
      // 404: Repository oder Release gibt es (noch) nicht – kein Fehler, nur „nichts da“
      if (res.status === 404) {
        setState({ status: 'none', latest: null, noRelease: true, error: null, checkedAt: Date.now() });
        return publicState();
      }
      if (!res.ok) throw new Error(`GitHub antwortet mit HTTP ${res.status}`);
      const latest = evaluateRelease(await res.json(), app.getVersion());
      if (latest.newer) latest.small = await smallUpdate(latest);
      const status = latest.newer && (latest.asset || latest.small) ? 'available' : 'none';
      setState({ status, latest, noRelease: false, error: null, checkedAt: Date.now() });
    } catch (e) {
      // Hintergrund-Fehler (offline usw.) nicht anzeigen, alten Stand behalten
      if (manual) setState({ status: 'error', error: e.message ?? String(e) });
    } finally {
      busy = null;
    }
    return publicState();
  })();
  return busy;
}

const overlay = () => require('./appOverlay.cjs');
const overlayRoot = () => overlay().rootDir(app.getPath('userData'));

/**
 * Geht ein kleines Update (nur App-Code)? Nur wenn das Paket für genau diese Electron-Version gebaut ist
 * und dieser Stand nicht schon einmal beim Start gescheitert ist – sonst die ganze .exe.
 */
async function smallUpdate(latest) {
  if (!latest.pack || !isPortable()) return null;
  if (overlay().failedVersion(overlayRoot()) === latest.version) return null;
  try {
    const res = await fetch(latest.pack.manifestUrl, { headers: { 'User-Agent': `CephalonMerlin/${app.getVersion()}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const m = await res.json();
    if (m.version !== latest.version || m.electron !== process.versions.electron || !/^[0-9a-f]{64}$/.test(m.sha256 ?? '')) return null;
    return { url: latest.pack.url, size: m.size || latest.pack.size, sha256: m.sha256, electron: m.electron };
  } catch {
    return null;
  }
}

/** Lädt eine Datei mit Fortschrittsanzeige; `sink(chunk)` nimmt die Stücke entgegen. */
async function fetchWithProgress(url, size, sink) {
  const res = await fetch(url, { headers: { 'User-Agent': `CephalonMerlin/${app.getVersion()}`, Accept: 'application/octet-stream' } });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  let done = 0;
  let lastSent = 0;
  for await (const chunk of res.body) {
    await sink(chunk);
    done += chunk.length;
    if (Date.now() - lastSent > 150) {
      lastSent = Date.now();
      setState({ progress: { done, total } });
    }
  }
  setState({ progress: { done, total } });
  if (size && done !== size) throw new Error('Download unvollständig');
}

async function downloadBuffer(url, size) {
  const parts = [];
  await fetchWithProgress(url, size, (chunk) => parts.push(Buffer.from(chunk)));
  return Buffer.concat(parts);
}

async function download(asset, file) {
  const out = fs.createWriteStream(file);
  try {
    await fetchWithProgress(asset.url, asset.size, async (chunk) => {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    });
  } finally {
    await new Promise((r) => out.end(r));
  }
  // Kurzer Plausibilitätstest: Windows-Programme beginnen mit „MZ“
  const head = Buffer.alloc(2);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'MZ') throw new Error('Heruntergeladene Datei ist keine .exe');
}

/** Hilfsskript starten (wartet auf das Ende der App) und App beenden. */
function restartVia({ tmpFile = null } = {}) {
  const exeFile = portableExe();
  const script = path.join(os.tmpdir(), `cephalon-merlin-update-${Date.now()}.ps1`);
  const logFile = path.join(app.getPath('userData'), 'update.log');
  // UTF-8 mit BOM, damit PowerShell 5 Umlaute in Pfaden richtig liest
  fs.writeFileSync(script, '﻿' + buildSwapScript({ pid: process.pid, tmpFile, exeFile, logFile }), 'utf8');
  setState({ status: 'installing' });
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  // app.exit statt app.quit: keine „Wirklich beenden?“-Abfrage, das Skript wartet schon
  setTimeout(() => app.exit(0), 400);
}

async function install() {
  if (!isPortable()) throw new Error('Aktualisieren geht nur in der portablen .exe');
  const latest = state.latest;
  if (state.status !== 'available' || !(latest?.small || latest?.asset)) throw new Error('Kein Update verfügbar');

  // Kleines Update: nur App-Code in den Datenordner, .exe bleibt
  if (latest.small) {
    setState({ status: 'downloading', progress: { done: 0, total: latest.small.size || 0 }, error: null });
    try {
      const gz = await downloadBuffer(latest.small.url, latest.small.size);
      if (overlay().sha256(gz) !== latest.small.sha256) throw new Error('Update-Paket beschädigt (Prüfsumme falsch)');
      overlay().installPack(overlayRoot(), gz, { version: latest.version, electron: process.versions.electron });
      restartVia();
      return true;
    } catch (e) {
      // Klappt das kleine Update nicht, beim nächsten Klick die ganze .exe nehmen
      setState({ status: latest.asset ? 'available' : 'error', latest: { ...latest, small: null }, progress: null, error: e.message ?? String(e) });
      throw e;
    }
  }

  const exeFile = portableExe();
  const tmpFile = path.join(path.dirname(exeFile), `${path.basename(exeFile, '.exe')}.update.tmp`);
  setState({ status: 'downloading', progress: { done: 0, total: latest.asset.size || 0 }, error: null });
  try {
    await download(latest.asset, tmpFile);
    restartVia({ tmpFile });
    return true;
  } catch (e) {
    fs.rmSync(tmpFile, { force: true });
    setState({ status: 'available', progress: null, error: e.message ?? String(e) });
    throw e;
  }
}

function setupUpdater() {
  ipcMain.handle('update:state', () => publicState());
  ipcMain.handle('update:check', () => check({ manual: true }));
  ipcMain.handle('update:install', () => install());
  // Läuft Code aus einem kleinen Update: gilt als gut, sobald ein Fenster geladen hat (sonst Rückfall, siehe boot.cjs)
  if (process.env.CM_APP_CODE) {
    app.on('browser-window-created', (_e, win) => {
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          try {
            overlay().confirm(overlayRoot(), app.getVersion());
          } catch {
            /* nächstes Mal */
          }
        }, 3000);
      });
    });
  }
  if (!readRepo()) {
    state = { status: 'off' };
    return;
  }
  if (!isPortable()) return; // Preview/Dev: nur von Hand prüfen
  setTimeout(() => check(), FIRST_CHECK_MS);
  setInterval(() => check(), INTERVAL_MS).unref?.();
}

module.exports = { setupUpdater, parseVersion, compareVersions, pickAsset, evaluateRelease, buildSwapScript };

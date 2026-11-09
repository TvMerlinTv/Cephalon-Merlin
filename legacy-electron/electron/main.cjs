const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { syncFromGame, importInventory, loadLastInventory, statsHistory } = require('./game.cjs');
const { getMasteryDb } = require('./masteryDb.cjs');
const { getRelicDb } = require('./relicDb.cjs');
const { getWorldState } = require('./world.cjs');

const { setupOverlay } = require('./overlay.cjs');
const { setupUpdater } = require('./updater.cjs'); // Selbst-Update über GitHub-Releases
const { setupAutoSync } = require('./autoSync.cjs');
let autoSync = null;
const settings = require('./settings.cjs');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

/** Lädt die Oberfläche; `view` = "overlay" für das Ingame-Overlay. */
function load(win, view = '') {
  if (isDev) win.loadURL(`http://localhost:5173/${view ? `#${view}` : ''}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: view });
}

// Nur diese Dienste darf der Renderer über IPC abfragen.
const SERVICES = {
  market: 'https://api.warframe.market', // warframe.market API v2
  stat: 'https://api.warframestat.us', // Weltstatus (Zyklen, Spalten, Baro)
  overframe: 'https://overframe.gg', // Builds – nur /api/v1/, mit Cache + Drossel (electron/overframe.cjs)
};

const EXTERNAL_HOSTS = new Set(['warframe.market', 'wiki.warframe.com', 'github.com', 'warframestat.us', 'hub.warframestat.us', 'www.warframe.com', 'overframe.gg', 'www.youtube.com']);
// Datenordner %APPDATA%\Cephalon Merlin – der alte %APPDATA%\tennodeck wird beim ersten Start umgezogen
// (vor app.ready, damit Chromium noch keine Dateien darin offen hat).
app.setPath('userData', require('./dataDir.cjs').resolveDataDir(app.getPath('appData')));
const dataDir = () => app.getPath('userData');
const log = require('./log.cjs');
log.setupLog(); // vor allen ipcMain.handle-Aufrufen, damit deren Fehler mitprotokolliert werden

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 820,
    minWidth: 1100,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0f1219',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  load(win);
  mainWindow = win;
  win.on('closed', () => (mainWindow = null));

  // Einstellung: auf den zweiten Monitor (zentriert)
  if (settings.get().secondMonitor) {
    const primary = screen.getPrimaryDisplay();
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (other) {
      const { x, y, width, height } = other.workArea;
      const [w, h] = win.getSize();
      win.setBounds({ x: Math.round(x + (width - w) / 2), y: Math.round(y + (height - h) / 2), width: w, height: h });
    }
  }

  // Einstellung: vor dem Schließen nachfragen
  let confirmed = false;
  win.on('close', async (e) => {
    if (confirmed || !settings.get().confirmClose) return;
    e.preventDefault();
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Beenden', 'Abbrechen'],
      defaultId: 0,
      cancelId: 1,
      title: 'Cephalon Merlin beenden?',
      message: 'Cephalon Merlin wirklich beenden?',
      detail: 'Damit verschwindet auch das Ingame-Overlay.',
      checkboxLabel: 'Nicht mehr fragen',
    });
    if (response === 0) {
      if (checkboxChecked) settings.update({ confirmClose: false });
      confirmed = true;
      win.close();
    }
  });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) shell.openExternal(u.toString());
  } catch {
    /* ungültige URL ignorieren */
  }
}

// ---------- öffentliche APIs ----------
ipcMain.handle('api:get', async (_e, service, apiPath, language) => {
  const base = SERVICES[service];
  if (!base || typeof apiPath !== 'string' || !apiPath.startsWith('/')) {
    throw new Error('Ungültige API-Anfrage');
  }
  const url = new URL(apiPath, base);
  if (url.origin !== base) throw new Error('Ungültige API-Anfrage');
  if (service === 'overframe') {
    return require('./overframe.cjs').overframeGet(dataDir(), apiPath, `CephalonMerlin/${app.getVersion()} (+https://github.com/TvMerlinTv/cephalon-merlin)`);
  }

  const res = await fetch(url, {
    headers: { Accept: 'application/json', Language: language === 'de' ? 'de' : 'en', Platform: 'pc', 'User-Agent': 'CephalonMerlin/0.1' },
  });
  if (!res.ok) {
    // Retry-After mitgeben, damit der Renderer bei 429 passend warten kann (src/lib/api.js)
    const retryAfter = res.headers.get('retry-after');
    throw new Error(`HTTP ${res.status} für ${url.pathname}${retryAfter ? ` (Retry-After ${retryAfter}s)` : ''}`);
  }
  return res.json();
});

// ---------- Spieldaten ----------
ipcMain.handle('game:sync', () => {
  autoSync?.noteSync(); // Intervall des Auto-Syncs neu zählen
  return syncFromGame(dataDir());
});
ipcMain.handle('game:last', () => loadLastInventory(dataDir()));
ipcMain.handle('stats:history', () => statsHistory(dataDir()));
ipcMain.handle('game:import', async (e) => {
  const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'inventory.json importieren',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return null;
  return importInventory(await fs.readFile(pick.filePaths[0], 'utf8'), dataDir());
});
ipcMain.handle('mastery:db', (_e, force) => getMasteryDb(dataDir(), !!force));
ipcMain.handle('relics:db', (_e, force) => getRelicDb(dataDir(), !!force));
ipcMain.handle('world:state', () => getWorldState(dataDir()));
// Belohnungs-Log der Spalten-Missionen (gespeichert vom Overlay, electron/rewardLog.cjs)
ipcMain.handle('rewardLog:list', () => require('./rewardLog.cjs').loadRuns(dataDir()));
ipcMain.handle('rewardLog:choose', (_e, id, chosen) => require('./rewardLog.cjs').setChoice(dataDir(), String(id), chosen));
ipcMain.handle('rewardLog:remove', (_e, id) => require('./rewardLog.cjs').removeRun(dataDir(), String(id)));

// ---------- Kleine Datenablage (z. B. To-Do-Liste), unabhängig vom Browser-Speicher ----------
const STORE_KEYS = new Set(['todo', 'builds', 'alerts', 'worldchecks', 'foundry']); // builds: Favoriten/In Arbeit der Builds-Seite; alerts: Preis-Alarme; worldchecks: Haken für Sortie/Archon/Nightwave; foundry: schon gemeldete Bauaufträge
const storeFile = (key) => path.join(dataDir(), `${key}.json`);
ipcMain.handle('store:get', async (_e, key) => {
  if (!STORE_KEYS.has(key)) throw new Error('Unbekannter Speicher');
  try {
    return JSON.parse(await fs.readFile(storeFile(key), 'utf8'));
  } catch {
    return null; // noch nichts gespeichert
  }
});
ipcMain.handle('store:set', async (_e, key, value) => {
  if (!STORE_KEYS.has(key)) throw new Error('Unbekannter Speicher');
  const json = JSON.stringify(value);
  if (json.length > 200_000) throw new Error('Zu groß');
  await fs.writeFile(storeFile(key), json, 'utf8');
  return true;
});

// ---------- Einstellungen ----------
ipcMain.handle('settings:get', () => ({ values: settings.get(), hotkeys: settings.HOTKEYS }));
ipcMain.handle('settings:set', (_e, patch) => settings.update(patch));
settings.onChange((values) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings:changed', values);
});

// ---------- Hilfe & Info ----------
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  dataDir: dataDir(),
}));
ipcMain.on('app:open-data', () => shell.openPath(dataDir()));
ipcMain.on('app:open-log', () => {
  const f = log.logFile();
  require('node:fs').existsSync(f) ? shell.showItemInFolder(f) : shell.openPath(dataDir());
});

// ---------- Fenster ----------
ipcMain.on('open-external', (_e, url) => openExternal(url));

ipcMain.on('window', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
  else if (action === 'focus') {
    // z. B. Klick auf eine Preis-Alarm-Benachrichtigung
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// Windows-Benachrichtigungen brauchen eine App-ID
app.setAppUserModelId('Cephalon Merlin');

app.whenReady().then(() => {
  settings.init(dataDir());
  setupUpdater();
  createWindow();
  setupOverlay({
    load,
    preload: path.join(__dirname, 'preload.cjs'),
    mainWindow: () => mainWindow,
    dataDir,
  });
  autoSync = setupAutoSync({ dataDir });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Das (unsichtbare) Overlay-Fenster zählt nicht: schließt der Nutzer das Hauptfenster, ist Schluss.
app.on('browser-window-created', (_e, win) => {
  win.on('closed', () => {
    if (!mainWindow) app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

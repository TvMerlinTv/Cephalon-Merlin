// Spieldaten laden – ohne Electron-Abhängigkeit, damit es auch der Vite-Dev-Server nutzen kann.
//
// Gleicher Weg wie AlecaFrame / WFHelper / warframe-api-helper: Sitzungs-Token
// read-only aus dem Spielprozess lesen und damit das eigene Inventar von DE laden.
// Der Token wird weder gespeichert noch an die Oberfläche weitergegeben.
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { summarizeInventory } = require('./inventory.cjs');
const { recordSnapshot, getHistory } = require('./stats.cjs');

const READER_ERRORS = {
  NOT_RUNNING: 'Warframe läuft nicht. Starte das Spiel und logge dich ein.',
  OPEN_FAILED: 'Kein Zugriff auf den Warframe-Prozess (läuft das Spiel als Administrator?).',
  NOT_FOUND: 'Kein Sitzungs-Token gefunden. Geh einmal in einen Ladebildschirm und versuch es erneut.',
};

const inventoryFile = (dataDir) => path.join(dataDir, 'inventory.json');
const playerFile = (dataDir) => path.join(dataDir, 'player.json');

// Der Spielername steht nicht im Inventar, aber im Spiel-Log: "Sys [Info]: Logged in <Name>".
async function readPlayerName() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  try {
    const log = await fs.readFile(path.join(local, 'Warframe', 'EE.log'), 'latin1');
    const matches = [...log.matchAll(/Logged in (\S+)/g)];
    return matches.length ? matches[matches.length - 1][1] : null;
  } catch {
    return null;
  }
}

// Profilbild = aktiver Glyph. Bildname aus WFCD/warframe-items; gemerkt in glyph.json.
const glyphFile = (dataDir) => path.join(dataDir, 'glyph.json');
async function glyphImage(type, dataDir) {
  if (!type) return null;
  const cached = await fs.readFile(glyphFile(dataDir), 'utf8').then(JSON.parse).catch(() => null);
  if (cached?.type === type) return cached.image;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/Glyphs.json', {
      headers: { 'User-Agent': 'CephalonMerlin/0.1' },
    });
    if (!res.ok) return cached?.image ?? null;
    const hit = (await res.json()).find((g) => g.uniqueName === type);
    const image = hit?.imageName ? `https://cdn.warframestat.us/img/${hit.imageName}` : null;
    await fs.writeFile(glyphFile(dataDir), JSON.stringify({ type, image }), 'utf8').catch(() => {});
    return image;
  } catch {
    return cached?.image ?? null; // offline: altes Bild behalten
  }
}

/** Hängt den Spielernamen an (aus EE.log, sonst der zuletzt bekannte). */
async function withPlayerName(summary, dataDir, avatarType) {
  summary.player.avatar = await glyphImage(avatarType, dataDir);
  let name = await readPlayerName();
  if (name) {
    await fs.writeFile(playerFile(dataDir), JSON.stringify({ name }), 'utf8').catch(() => {});
  } else {
    name = await fs.readFile(playerFile(dataDir), 'utf8').then((t) => JSON.parse(t).name).catch(() => null);
  }
  summary.player.name = name;
  return summary;
}

// Speicherbereiche, in denen der Token zuletzt lag (nur Adressen, kein Token) –
// der nächste Scan schaut dort zuerst nach und ist dann meist in Sekunden fertig.
let regionHint = '';

function readAuthz() {
  if (process.platform !== 'win32') return Promise.reject(new Error('Spiel-Sync gibt es nur unter Windows.'));
  const script = path.join(__dirname, 'gameReader.ps1').replace('app.asar', 'app.asar.unpacked');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (regionHint) args.push('-Hint', regionHint);
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      args,
      { timeout: 180_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const [out, hint = ''] = String(stdout || '').trim().split('\t');
        if (/^\?accountId=[0-9a-fA-F]{24}&nonce=\d+$/.test(out)) {
          if (/^[0-9a-f,]*$/.test(hint)) regionHint = hint;
          return resolve(out);
        }
        if (out.startsWith('ERR:')) {
          const code = out.slice(4);
          return reject(new Error(READER_ERRORS[code] ?? `Lesefehler: ${code}`));
        }
        reject(new Error(err ? `Leser fehlgeschlagen: ${err.message}` : 'Unerwartete Ausgabe des Lesers.'));
      },
    );
  });
}

function parseInventory(text) {
  let inv;
  try {
    inv = JSON.parse(text);
  } catch {
    return null;
  }
  return inv && Array.isArray(inv.MiscItems) ? inv : null;
}

// Läuft schon ein Sync, hängen sich weitere Aufrufe an (der Speicher-Scan dauert etwas).
let running = null;
function syncFromGame(dataDir) {
  running ??= doSync(dataDir).finally(() => {
    running = null;
  });
  return running;
}

async function fetchInventory(authz) {
  const res = await fetch(`https://mobile.warframe.com/api/inventory.php${authz}`, {
    headers: { 'User-Agent': 'CephalonMerlin/0.1' },
  });
  if (!res.ok) throw new Error(`Warframe-API antwortete mit HTTP ${res.status}. Später erneut versuchen.`);
  const text = await res.text();
  return { text, inv: parseInventory(text) };
}

async function doSync(dataDir) {
  const usedHint = !!regionHint;
  let { text, inv } = await fetchInventory(await readAuthz());
  if (!inv && usedHint) {
    // Alter Token aus dem gemerkten Bereich? Dann einmal komplett neu suchen.
    regionHint = '';
    ({ text, inv } = await fetchInventory(await readAuthz()));
  }
  if (!inv) throw new Error('Token abgelaufen – geh in einen Ladebildschirm und synchronisiere erneut.');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(inventoryFile(dataDir), text, 'utf8');
  return withSnapshot(await withPlayerName(summarizeInventory(inv, Date.now(), 'game'), dataDir, inv.ActiveAvatarImageType), dataDir);
}

async function importInventory(text, dataDir) {
  const inv = parseInventory(text);
  if (!inv) throw new Error('Die Datei ist kein Warframe-Inventar (inventory.json).');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(inventoryFile(dataDir), text, 'utf8');
  return withSnapshot(await withPlayerName(summarizeInventory(inv, Date.now(), 'import'), dataDir, inv.ActiveAvatarImageType), dataDir);
}

async function loadLastInventory(dataDir) {
  try {
    const file = inventoryFile(dataDir);
    const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const inv = parseInventory(text);
    return inv ? withPlayerName(summarizeInventory(inv, stat.mtimeMs, 'cache'), dataDir, inv.ActiveAvatarImageType) : null;
  } catch {
    return null;
  }
}

// Statistik-Verlauf: jeder Sync/Import ist ein Punkt (Fehler beim Schreiben blockieren den Sync nicht)
async function withSnapshot(summary, dataDir) {
  await recordSnapshot(dataDir, summary).catch(() => {});
  return summary;
}

async function statsHistory(dataDir) {
  return getHistory(dataDir, await loadLastInventory(dataDir));
}

module.exports = { syncFromGame, importInventory, loadLastInventory, statsHistory };

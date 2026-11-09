// Builds von overframe.gg (öffentliche, undokumentierte REST-API unter /api/v1/).
// Rücksichtsvoll: höchstens ~1 Anfrage pro Sekunde, Antworten 45 Minuten zwischengespeichert
// (im Speicher und in <Datenordner>/overframe-cache.json, damit ein Neustart nicht alles neu lädt).
const path = require('node:path');
const fs = require('node:fs/promises');

const BASE = 'https://overframe.gg';
const TTL = 45 * 60 * 1000;
const GAP_MS = 1100;
const MAX_ENTRIES = 300;

let cache = null; // Map(path -> { ts, data })
let cacheFile = null;
let saveTimer = null;
let tail = Promise.resolve();
let lastSent = 0;

async function loadCache(dataDir) {
  if (cache) return;
  cache = new Map();
  cacheFile = path.join(dataDir, 'overframe-cache.json');
  try {
    const raw = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    for (const [k, v] of Object.entries(raw)) if (Date.now() - v.ts < TTL) cache.set(k, v);
  } catch {
    /* noch kein Cache */
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Nur frische Einträge, die neuesten zuerst behalten
    const entries = [...cache.entries()].filter(([, v]) => Date.now() - v.ts < TTL).slice(-MAX_ENTRIES);
    fs.writeFile(cacheFile, JSON.stringify(Object.fromEntries(entries)), 'utf8').catch(() => {});
  }, 2000);
}

// Anfragen nacheinander mit Mindestabstand
function queued(task) {
  const run = tail.then(async () => {
    const wait = lastSent + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSent = Date.now();
    return task();
  });
  tail = run.catch(() => {});
  return run;
}

/** GET auf overframe.gg/api/v1/… (nur dieser Pfad ist erlaubt). */
async function overframeGet(dataDir, apiPath, userAgent) {
  const url = new URL(apiPath, BASE);
  if (url.origin !== BASE || !url.pathname.startsWith('/api/v1/')) throw new Error('Ungültige API-Anfrage');
  const key = url.pathname + url.search;

  await loadCache(dataDir);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const data = await queued(async () => {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status} für ${url.pathname}`);
      const type = res.headers.get('content-type') ?? '';
      // Cloudflare-Prüfseite statt JSON
      if (!type.includes('json')) throw new Error(`HTTP 403 für ${url.pathname} (Cloudflare)`);
      return res.json();
    });
    cache.delete(key);
    cache.set(key, { ts: Date.now(), data });
    scheduleSave();
    return data;
  } catch (e) {
    if (hit) return hit.data; // lieber veraltet als gar nichts
    throw e;
  }
}

module.exports = { overframeGet };

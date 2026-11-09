// Zugriff auf warframe.market (v2) und warframestat.us.
// In Electron läuft alles über window.wf (Main-Prozess), im Browser über den Vite-Proxy.

export const isElectron = typeof window !== 'undefined' && !!window.wf;
export const MARKET_ASSETS = 'https://warframe.market/static/assets/';

async function getJson(service, path, language = 'en') {
  if (isElectron) return window.wf.get(service, path, language);
  const res = await fetch(`/proxy/${service}${path}`, { headers: { Accept: 'application/json', Language: language } });
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    throw new Error(`HTTP ${res.status} für ${path}${retryAfter ? ` (Retry-After ${retryAfter}s)` : ''}`);
  }
  return res.json();
}

export function openExternal(url) {
  if (isElectron) window.wf.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

// ---------- Warteschlangen für warframe.market ----------
// v2 erlaubt ca. 3 Anfragen pro Sekunde. Die Riven-Auktionen (v1) sind viel strenger: Cloudflare
// sperrt nach ca. 10 Anfragen pro Minute für bis zu 60 s (HTTP 429 mit Retry-After).
// Jede Spur arbeitet ihre Anfragen nacheinander ab und hält Mindestabstand + Minutenlimit ein.
const MARKET_GAP_MS = 380;
const lane = (gap, max = Infinity, window = 0) => ({ gap, max, window, tail: Promise.resolve(), sent: [], pauseUntil: 0 });
const LANES = {
  market: lane(MARKET_GAP_MS),
  auctions: lane(1500, 8, 60_000),
};
const laneFor = (path) => (path.startsWith('/v1/auctions') ? LANES.auctions : LANES.market);

const MAX_RETRIES = 3;
// Längere Sperren nicht still abwarten, sondern als „ausgelastet“ melden (mit retryAt)
const MAX_SILENT_WAIT_MS = 8000;

function abortError() {
  return new DOMException('Abgebrochen', 'AbortError');
}
export const isAbort = (e) => e?.name === 'AbortError';

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/** HTTP-Status aus einer Fehlermeldung wie „HTTP 429 für …“ (auch durch IPC durchgereicht). */
export function httpStatus(e) {
  const m = /HTTP (\d{3})/.exec(e?.message ?? '');
  return m ? Number(m[1]) : null;
}
/** true bei 429 / 5xx – der Server ist nur gerade ausgelastet, später klappt es wieder. */
export function isBusy(e) {
  const s = httpStatus(e);
  return s === 429 || (s >= 500 && s < 600);
}
function retryAfterMs(e) {
  const m = /Retry-After (\d+)s/.exec(e?.message ?? '');
  return m ? Number(m[1]) * 1000 : null;
}

// Wartet, bis die Spur wieder senden darf (Pause nach 429, Mindestabstand, Minutenlimit)
async function takeSlot(l, signal) {
  for (;;) {
    if (signal?.aborted) return false;
    const now = Date.now();
    l.sent = l.sent.filter((ts) => now - ts < l.window);
    const last = l.lastSent ?? 0;
    const wait = Math.max(l.pauseUntil - now, last + l.gap - now, l.sent.length >= l.max ? l.sent[0] + l.window - now : 0);
    if (wait <= 0) {
      l.lastSent = now;
      if (l.window) l.sent.push(now);
      return true;
    }
    await sleep(wait, signal);
  }
}

function enqueue(l, task, signal) {
  const run = l.tail.then(async () => {
    // Abgebrochene Anfragen (z. B. Riven schon wieder weggeklickt) verbrauchen keinen Platz
    if (!(await takeSlot(l, signal))) return { aborted: true };
    try {
      return { value: await task() };
    } catch (error) {
      return { error };
    }
  });
  l.tail = run;
  return run.then((r) => {
    if (r.aborted) throw abortError();
    if (r.error) throw r.error;
    return r.value;
  });
}

/**
 * GET auf warframe.market über die passende Warteschlange.
 * Bei 429/5xx wird mit Backoff (1 s, 2 s, 4 s bzw. Retry-After) neu versucht.
 * Dauert die Sperre länger, kommt der Fehler sofort zurück – mit e.retryAt (Zeitpunkt in ms).
 */
export async function marketGet(path, language, { signal } = {}) {
  const l = laneFor(path);
  for (let attempt = 0; ; attempt++) {
    try {
      return await enqueue(l, () => getJson('market', path, language), signal);
    } catch (e) {
      if (!isBusy(e) || signal?.aborted) throw e;
      const delay = Math.max(retryAfterMs(e) ?? 0, 1000 * 2 ** attempt);
      // Bei 429 pausiert die ganze Spur, sonst würden die nächsten Anfragen die Sperre verlängern
      if (httpStatus(e) === 429) l.pauseUntil = Math.max(l.pauseUntil, Date.now() + delay);
      if (attempt >= MAX_RETRIES || delay > MAX_SILENT_WAIT_MS) {
        e.retryAt = Math.max(l.pauseUntil, Date.now() + delay);
        throw e;
      }
      if (httpStatus(e) !== 429) await sleep(delay, signal);
    }
  }
}

// ---------- kleine localStorage-Helfer (können im privaten Modus fehlen) ----------
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

// ---------- Items ----------
const ITEMS_KEY = 'td.items.v2'; // v2: mit maxRank
const ITEMS_TTL = 24 * 60 * 60 * 1000;
let itemsPromise = null;

function normalizeItem(i) {
  const en = i.i18n?.en ?? {};
  return {
    id: i.id,
    slug: i.slug,
    gameRef: i.gameRef ?? null,
    name: en.name ?? i.slug,
    thumb: en.thumb ? MARKET_ASSETS + en.thumb : null,
    tags: i.tags ?? [],
    ducats: i.ducats ?? null,
    vaulted: i.vaulted ?? null,
    maxRank: i.maxRank ?? null, // Mods/Arcanes: Preise hängen stark vom Rang ab
  };
}

export function getItems() {
  if (!itemsPromise) {
    const cached = load(ITEMS_KEY, null);
    if (cached && Date.now() - cached.ts < ITEMS_TTL) {
      itemsPromise = Promise.resolve(cached.items);
    } else {
      itemsPromise = marketGet('/v2/items')
        .then((r) => {
          const items = r.data.map(normalizeItem).sort((a, b) => a.name.localeCompare(b.name));
          save(ITEMS_KEY, { ts: Date.now(), items });
          return items;
        })
        .catch((e) => {
          itemsPromise = null;
          if (cached) return cached.items;
          throw e;
        });
    }
  }
  return itemsPromise;
}

// ---------- Preise ----------
// v2: Preise je Rang (vorher Rang 0 und Max gemischt, z. B. SELL Rang 0 neben BUY Max)
const PRICE_KEY = 'td.prices.v2';
const PRICE_TTL = 15 * 60 * 1000;
const priceCache = load(PRICE_KEY, {});
const pricePending = new Map();

const priceKey = (slug, rank) => (rank ? `${slug}@${rank}` : slug);

/**
 * Liefert { wts, wtb, ts } – günstigstes Verkaufs- und höchstes Kaufangebot (online/ingame).
 * rank: Mod-/Arcane-Rang (Standard 0 = unverbessert, wie im Inventar). Items ohne Rang ignorieren ihn.
 */
export function getPrice(slug, { force = false, rank = 0 } = {}) {
  const key = priceKey(slug, rank);
  const hit = priceCache[key];
  if (!force && hit && Date.now() - hit.ts < PRICE_TTL) return Promise.resolve(hit);
  if (pricePending.has(key)) return pricePending.get(key);

  const p = getTopOrders(slug, rank)
    .then(({ sell, buy }) => {
      const price = {
        wts: sell.length ? Math.min(...sell.map((o) => o.platinum)) : null,
        wtb: buy.length ? Math.max(...buy.map((o) => o.platinum)) : null,
        ts: Date.now(),
      };
      priceCache[key] = price;
      save(PRICE_KEY, priceCache);
      return price;
    })
    .finally(() => pricePending.delete(key));
  pricePending.set(key, p);
  return p;
}

export function getCachedPrice(slug, rank = 0) {
  return priceCache[priceKey(slug, rank)] ?? null;
}

/** Top-Aufträge eines Items (nur Spieler, die gerade online sind); rank filtert Mods/Arcanes, null = alle Ränge. */
export async function getTopOrders(slug, rank = null) {
  const q = rank != null ? `?rank=${Number(rank)}` : '';
  const r = await marketGet(`/v2/orders/item/${encodeURIComponent(slug)}/top${q}`);
  return { sell: r.data?.sell ?? [], buy: r.data?.buy ?? [] };
}

// ---------- Spieldaten (Inventar aus dem Spiel, Mastery-Datenbank) ----------
async function local(path, method = 'GET') {
  const res = await fetch(`/local${path}`, { method });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

export const game = {
  sync: () => (isElectron ? window.wf.syncGame() : local('/sync', 'POST')),
  last: () => (isElectron ? window.wf.lastInventory() : local('/last')),
  statsHistory: () => (isElectron ? window.wf.statsHistory() : local('/stats')),
  // Belohnungs-Log der Spalten-Missionen
  rewardLog: () => (isElectron ? window.wf.rewardLog() : local('/reward-log')),
  rewardLogChoose: (id, chosen) =>
    isElectron
      ? window.wf.rewardLogChoose(id, chosen)
      : local(`/reward-log?id=${encodeURIComponent(id)}${chosen ? `&chosen=${encodeURIComponent(chosen)}` : ''}`, 'POST'),
  rewardLogRemove: (id) => (isElectron ? window.wf.rewardLogRemove(id) : local(`/reward-log?id=${encodeURIComponent(id)}&remove`, 'POST')),
  /** Nur in Electron: Dateidialog für eine inventory.json (z. B. von warframe-api-helper). */
  importFile: () => (isElectron ? window.wf.importInventory() : Promise.resolve(null)),
  masteryDb: (force = false) => (isElectron ? window.wf.masteryDb(force) : local(`/mastery${force ? '?force' : ''}`)),
  relicDb: (force = false) => (isElectron ? window.wf.relicDb(force) : local(`/relics${force ? '?force' : ''}`)),
};

// ---------- Sammelpreise für Prime-Teile (gleiche Quelle wie WFinfo) ----------
// Eine Anfrage statt hunderte: Durchschnittspreis pro Item-Name, stündlich aktualisiert.
const BULK_KEY = 'td.bulkprices.v1';
const BULK_TTL = 60 * 60 * 1000;
let bulkPromise = null;
export function getBulkPrices() {
  if (!bulkPromise) {
    const cached = load(BULK_KEY, null);
    if (cached && Date.now() - cached.ts < BULK_TTL) {
      bulkPromise = Promise.resolve(cached.prices);
    } else {
      bulkPromise = getJson('stat', '/wfinfo/prices')
        .then((list) => {
          const prices = {};
          for (const p of list) prices[p.name.toLowerCase()] = Number(p.custom_avg) || 0;
          save(BULK_KEY, { ts: Date.now(), prices });
          return prices;
        })
        .catch((e) => {
          bulkPromise = null;
          if (cached) return cached.prices;
          throw e;
        });
    }
  }
  return bulkPromise;
}

// ---------- Weltstatus ----------
// Direkt vom offiziellen Warframe-Weltstatus (electron/world.cjs): Zyklen, Spalten, Void-Stürme, Baro
export const getWorldState = () => (isElectron ? window.wf.worldState() : local('/world'));

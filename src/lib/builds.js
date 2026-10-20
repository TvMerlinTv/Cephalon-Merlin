// Builds von overframe.gg. In Electron cacht und drosselt der Main-Prozess (electron/overframe.cjs),
// im Browser-Modus läuft es über den Vite-Proxy.
import { isElectron, load, save, httpStatus } from './api.js';

export const OVERFRAME = 'https://overframe.gg';

const memo = new Map(); // Pfad -> Promise (pro Sitzung)
function overframeGet(path) {
  if (!memo.has(path)) {
    const p = (
      isElectron
        ? window.wf.get('overframe', path, 'en')
        : fetch(`/proxy/overframe${path}`, { headers: { Accept: 'application/json' } }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status} für ${path}`);
            if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP 403 für ${path} (Cloudflare)`);
            return r.json();
          })
    ).catch((e) => {
      memo.delete(path);
      throw e;
    });
    memo.set(path, p);
  }
  return memo.get(path);
}

/** Top-Builds (max. 25, nach Stimmen) für den englischen Item-Namen. */
export async function getBuilds(itemName) {
  const r = await overframeGet(`/api/v1/builds/?item_name=${encodeURIComponent(itemName)}`);
  return r.results ?? [];
}

export const getBuild = (id) => overframeGet(`/api/v1/builds/${Number(id)}/`);

/** Fehler in einen freundlichen Text übersetzen ('offline' | 'blocked' | 'busy' | 'other'). */
export function buildsErrorKind(e) {
  const s = httpStatus(e);
  if (s === 403 || s === 503 || /Cloudflare/.test(e?.message ?? '')) return 'blocked';
  if (s === 429 || (s >= 500 && s < 600)) return 'busy';
  if (s === 404) return 'missing';
  if (!s) return 'offline';
  return 'other';
}

// ---------- Zuletzt angesehen ----------
const RECENT_KEY = 'td.builds.recent';
export const loadRecent = () => load(RECENT_KEY, []);
export function pushRecent(name) {
  const list = [name, ...loadRecent().filter((n) => n !== name)].slice(0, 12);
  save(RECENT_KEY, list);
  return list;
}

// ---------- Von anderen Seiten aus öffnen (z. B. Item-Details) ----------
const PENDING_KEY = 'td.builds.item';
export function openBuilds(itemName) {
  save(PENDING_KEY, itemName);
  pushRecent(itemName);
  window.dispatchEvent(new CustomEvent('cm:navigate', { detail: 'builds' }));
}
export const loadSelectedItem = () => load(PENDING_KEY, null);
export const saveSelectedItem = (name) => save(PENDING_KEY, name);

// Markt-Seite mit einem Item öffnen (Mods in Builds)
const MARKET_KEY = 'td.market.pending';
// rank (optional, z. B. Preis-Alarm): 0 = Rang 0, sonst Max
export function openMarket(slug, rank = null) {
  save(MARKET_KEY, slug);
  if (rank != null) save('td.market.rank', rank ? 'max' : '0');
  window.dispatchEvent(new CustomEvent('cm:navigate', { detail: 'market' }));
  window.dispatchEvent(new CustomEvent('cm:market-item')); // Markt-Seite schon offen
}
export function takeMarketItem() {
  const slug = load(MARKET_KEY, null);
  if (slug) save(MARKET_KEY, null);
  return slug;
}

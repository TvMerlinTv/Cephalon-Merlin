// Builds von overframe.gg. Gecacht und gedrosselt im Rust-Teil (src-tauri/src/overframe.rs).
import { call, load, save } from './ipc.js';

export const OVERFRAME = 'https://overframe.gg';

const memo = new Map(); // Pfad -> Promise (pro Sitzung)
function overframeGet(path) {
  if (!memo.has(path)) {
    const p = call('overframe_get', { path }).catch((e) => {
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

const httpStatus = (e) => {
  const m = /HTTP (\d{3})/.exec(e?.message ?? '');
  return m ? Number(m[1]) : null;
};
/** Fehler in einen freundlichen Text übersetzen ('offline' | 'blocked' | 'busy' | 'missing' | 'other'). */
export function buildsErrorKind(e) {
  const s = httpStatus(e);
  if (s === 403 || s === 503 || /Cloudflare/.test(e?.message ?? '')) return 'blocked';
  if (s === 429 || (s >= 500 && s < 600)) return 'busy';
  if (s === 404) return 'missing';
  if (!s) return 'offline';
  return 'other';
}

// ---------- Zuletzt angesehen ----------
const RECENT_KEY = 'cm.builds.recent';
export const loadRecent = () => load(RECENT_KEY, []);
export function pushRecent(name) {
  const list = [name, ...loadRecent().filter((n) => n !== name)].slice(0, 12);
  save(RECENT_KEY, list);
  return list;
}

// ---------- Von anderen Seiten aus öffnen (z. B. Item-Details) ----------
const PENDING_KEY = 'cm.builds.pending';
export function openBuilds(itemName) {
  save(PENDING_KEY, itemName);
  window.dispatchEvent(new CustomEvent('cm:navigate', { detail: 'builds' }));
  window.dispatchEvent(new CustomEvent('cm:builds-item'));
}
export const loadSelectedItem = () => load(PENDING_KEY, null);
export const saveSelectedItem = (name) => save(PENDING_KEY, name);

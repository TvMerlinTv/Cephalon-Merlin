// warframe.market: Item-Liste und Preise. Warteschlange, 429-Pausen und Cache liegen im Rust-Teil
// (src-tauri/src/net.rs) – hier nur ein reaktiver Spiegel der Preise für die Anzeige.
import { createStore } from 'solid-js/store';
import { call, isTauri } from './ipc.js';

let itemsPromise = null;
export function getItems(force = false) {
  if (!isTauri) return Promise.reject(new Error('Nur in der Desktop-App verfügbar'));
  if (!itemsPromise || force) {
    itemsPromise = call('market_items', { force }).catch((e) => {
      itemsPromise = null;
      throw e;
    });
  }
  return itemsPromise;
}

const priceKey = (slug, rank) => (rank ? `${slug}@${rank}` : slug);
// { "slug": { wts, wtb, ts } | { error: true } }
const [prices, setPrices] = createStore({});
export { prices };

if (isTauri) call('market_prices_cached').then((all) => setPrices(all)).catch(() => {});

const pending = new Map();
/** Preis laden (Rust entscheidet, ob der Cache reicht). */
export function loadPrice(slug, { rank = 0, force = false } = {}) {
  const key = priceKey(slug, rank);
  if (!force && pending.has(key)) return pending.get(key);
  const p = call('market_price', { slug, rank, force })
    .then((price) => {
      setPrices(key, price);
      return price;
    })
    .catch((e) => {
      if (!prices[key]) setPrices(key, { wts: null, wtb: null, error: true });
      throw e;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export const cachedPrice = (slug, rank = 0) => prices[priceKey(slug, rank)] ?? null;

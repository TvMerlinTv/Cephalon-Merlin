// Seitenleiste anpassen: Reihenfolge und ausgeblendete Seiten (pro Gerät gemerkt).
// Ausgeblendete Seiten bleiben über die Suche (Strg+K) erreichbar.
import { createSignal } from 'solid-js';
import { load, save } from './ipc.js';

const KEY = 'cm.nav.v1';
const [prefs, setPrefs] = createSignal(load(KEY, { order: [], hidden: [] }));
export { prefs as navPrefs };

function store(next) {
  setPrefs(next);
  save(KEY, next);
}

/** Alle Seiten in der gewählten Reihenfolge; neue (noch nicht einsortierte) behalten ihren Platz aus `nav`. */
export function orderNav(nav, order) {
  const pos = new Map(order.map((id, i) => [id, i]));
  return nav
    .map((item, i) => ({ item, key: pos.has(item.id) ? pos.get(item.id) : i - 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item);
}

export const orderedNav = (nav) => orderNav(nav, prefs().order ?? []);
export const visibleNav = (nav) => orderedNav(nav).filter((n) => !(prefs().hidden ?? []).includes(n.id));
export const isHidden = (id) => (prefs().hidden ?? []).includes(id);

export function toggleHidden(id) {
  const hidden = new Set(prefs().hidden ?? []);
  hidden.has(id) ? hidden.delete(id) : hidden.add(id);
  store({ ...prefs(), hidden: [...hidden] });
}

/** Seite um einen Platz nach oben (-1) oder unten (+1) schieben. */
export function moveNav(nav, id, dir) {
  const ids = orderedNav(nav).map((n) => n.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  store({ ...prefs(), order: ids });
}

export const resetNav = () => store({ order: [], hidden: [] });
export const navCustomized = () => (prefs().order ?? []).length > 0 || (prefs().hidden ?? []).length > 0;

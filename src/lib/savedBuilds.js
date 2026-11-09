// Gemerkte Overframe-Builds: Favoriten und Builds „in Arbeit“ (mit abgehakten Mod-Plätzen).
// Datei builds.json im Datenordner (gleiches Format wie die Electron-Version).
// Form: { builds: { [id]: Schnappschuss }, fav: [id], active: [id], done: [id], checks: { [id]: [slotId] } }
import { createStore, reconcile } from 'solid-js/store';
import { call, isTauri } from './ipc.js';

const EMPTY = { builds: {}, fav: [], active: [], done: [], checks: {} };
const [saved, setSaved] = createStore({ ...EMPTY });
export { saved };

if (isTauri) {
  call('store_get', { key: 'builds' })
    .then((stored) => stored && typeof stored === 'object' && setSaved(reconcile({ ...EMPTY, ...stored })))
    .catch(() => {});
}

const plain = () => JSON.parse(JSON.stringify(saved));

function set(next) {
  // Schnappschüsse nur behalten, solange der Build noch in einer Liste steht
  const keep = new Set([...next.fav, ...next.active, ...next.done].map(String));
  const builds = Object.fromEntries(Object.entries(next.builds).filter(([id]) => keep.has(id)));
  const checks = Object.fromEntries(Object.entries(next.checks).filter(([id]) => keep.has(id)));
  const state = { ...next, builds, checks };
  setSaved(reconcile(state));
  if (isTauri) call('store_set', { key: 'builds', value: state }).catch(() => {});
}

/** Das Nötigste eines Builds, damit die Listen ohne neue Anfrage an overframe.gg funktionieren. */
export function snapshot(b, itemName) {
  return {
    id: b.id,
    title: b.title,
    url: b.url,
    item: itemName ?? null,
    author: b.author?.username ?? null,
    score: b.score,
    formas: b.formas,
    updated: b.updated,
    slots: (b.slots ?? []).map(({ slot_id, mod, rank, polarity, drain, polarity_match }) => ({ slot_id, mod, rank, polarity, drain, polarity_match })),
  };
}

const without = (list, id) => list.filter((x) => x !== id);

export function toggleFavorite(build) {
  const s = plain();
  const on = s.fav.includes(build.id);
  set({ ...s, fav: on ? without(s.fav, build.id) : [build.id, ...s.fav], builds: { ...s.builds, [build.id]: { ...s.builds[build.id], ...build } } });
}

/** Verfolgen an/aus. Ein fertiger Build kommt damit wieder in „In Arbeit“. */
export function toggleActive(build) {
  const s = plain();
  const on = s.active.includes(build.id);
  set({ ...s, active: on ? without(s.active, build.id) : [build.id, ...s.active], done: without(s.done, build.id), builds: { ...s.builds, [build.id]: { ...s.builds[build.id], ...build } } });
}

export function markDone(id) {
  const s = plain();
  set({ ...s, active: without(s.active, id), done: [id, ...without(s.done, id)] });
}

export function removeDone(id) {
  const s = plain();
  set({ ...s, done: without(s.done, id) });
}

export function toggleCheck(id, slotId) {
  const s = plain();
  const list = s.checks[id] ?? [];
  set({ ...s, checks: { ...s.checks, [id]: list.includes(slotId) ? without(list, slotId) : [...list, slotId] } });
}

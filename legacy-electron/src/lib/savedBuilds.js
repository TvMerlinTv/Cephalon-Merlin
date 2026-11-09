import { useEffect, useState } from 'react';
import { isElectron, load, save } from './api.js';

// Gemerkte Overframe-Builds: Favoriten und Builds „in Arbeit“ (mit abgehakten Mod-Plätzen).
// Wie die To-Do-Liste (src/lib/todo.js): in der Desktop-App als Datei im Datenordner (builds.json),
// localStorage bleibt Kopie und Browser-Fallback.
// Form: { builds: { [id]: Schnappschuss }, fav: [id], active: [id], done: [id], checks: { [id]: [slotId] } }
const KEY = 'td.builds.saved.v1';
const EMPTY = { builds: {}, fav: [], active: [], done: [], checks: {} };
let state = { ...EMPTY, ...load(KEY, {}) };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));

if (isElectron && window.wf.storeGet) {
  window.wf.storeGet('builds').then((stored) => {
    if (stored && typeof stored === 'object') {
      state = { ...EMPTY, ...stored };
      save(KEY, state);
      emit();
    } else if (state.fav.length || state.active.length || state.done.length) {
      window.wf.storeSet('builds', state);
    }
  });
}

function set(next) {
  // Schnappschüsse nur behalten, solange der Build noch in einer Liste steht
  const keep = new Set([...next.fav, ...next.active, ...next.done].map(String));
  const builds = Object.fromEntries(Object.entries(next.builds).filter(([id]) => keep.has(id)));
  const checks = Object.fromEntries(Object.entries(next.checks).filter(([id]) => keep.has(id)));
  state = { ...next, builds, checks };
  save(KEY, state);
  if (isElectron) window.wf.storeSet?.('builds', state);
  emit();
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
  const id = build.id;
  const on = state.fav.includes(id);
  set({ ...state, fav: on ? without(state.fav, id) : [id, ...state.fav], builds: { ...state.builds, [id]: { ...state.builds[id], ...build } } });
}

/** Verfolgen an/aus. Ein fertiger Build kommt damit wieder in „In Arbeit“. */
export function toggleActive(build) {
  const id = build.id;
  const on = state.active.includes(id);
  set({
    ...state,
    active: on ? without(state.active, id) : [id, ...state.active],
    done: without(state.done, id),
    builds: { ...state.builds, [id]: { ...state.builds[id], ...build } },
  });
}

export function markDone(id) {
  set({ ...state, active: without(state.active, id), done: [id, ...without(state.done, id)] });
}

export function removeDone(id) {
  set({ ...state, done: without(state.done, id) });
}

export function toggleCheck(id, slotId) {
  const list = state.checks[id] ?? [];
  set({ ...state, checks: { ...state.checks, [id]: list.includes(slotId) ? without(list, slotId) : [...list, slotId] } });
}

export function useSavedBuilds() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

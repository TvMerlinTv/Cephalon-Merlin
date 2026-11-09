import { useEffect, useState } from 'react';
import { isElectron, load, save } from './api.js';

// Abgehakte Sortie, Archon-Jagd und Nightwave-Herausforderungen.
// Wie src/lib/savedBuilds.js: in der Desktop-App als Datei im Datenordner (worldchecks.json),
// localStorage bleibt Kopie und Browser-Fallback.
// Form: { sortie: id|null, archon: id|null, nw: [challengeId] }
// Sortie/Archon merken sich die ID der erledigten Runde – kommt eine neue, ist der Haken von selbst weg.
const KEY = 'td.worldchecks.v1';
const EMPTY = { sortie: null, archon: null, nw: [] };
let state = { ...EMPTY, ...load(KEY, {}) };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));
let ready = !(isElectron && window.wf.storeGet); // erst nach dem Laden der Datei aufräumen

if (isElectron && window.wf.storeGet) {
  window.wf.storeGet('worldchecks').then((stored) => {
    ready = true;
    if (stored && typeof stored === 'object') {
      state = { ...EMPTY, ...stored };
      save(KEY, state);
      emit();
    } else if (state.sortie || state.archon || state.nw.length) {
      window.wf.storeSet('worldchecks', state);
    }
  });
}

function set(next) {
  state = next;
  save(KEY, state);
  if (isElectron) window.wf.storeSet?.('worldchecks', state);
  emit();
}

/** Sortie oder Archon-Jagd (kind) für die Runde `id` an/aus. */
export function toggleRound(kind, id) {
  set({ ...state, [kind]: state[kind] === id ? null : id });
}

/** Nightwave-Herausforderung an/aus; `activeIds` = aktuelle IDs, alte fallen dabei weg. */
export function toggleChallenge(id, activeIds) {
  const keep = new Set(activeIds);
  const nw = state.nw.filter((x) => x !== id && keep.has(x));
  if (!state.nw.includes(id)) nw.push(id);
  set({ ...state, nw });
}

/** Haken abgelaufener Herausforderungen entfernen (beim Laden neuer Weltdaten). */
export function pruneChallenges(activeIds) {
  if (!ready || !activeIds.length) return;
  const keep = new Set(activeIds);
  const nw = state.nw.filter((x) => keep.has(x));
  if (nw.length !== state.nw.length) set({ ...state, nw });
}

export function useWorldChecks() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

// Weltstatus: kommt jede Minute vom Rust-Teil (Ereignis "world"), hier nur gespiegelt.
// Dazu die Haken für Sortie, Archon-Jagd und Nightwave (worldchecks.json im Datenordner).
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { call, isTauri, on } from './ipc.js';

const [world, setWorld] = createStore({});
export { world };

if (isTauri) {
  call('world_state')
    .then((w) => setWorld(reconcile(w)))
    .catch(() => {}); // der Rust-Teil versucht es weiter und schickt das Ergebnis
  on('world', (w) => setWorld(reconcile(w)));
}

// Eine gemeinsame Uhr für alle Countdowns (1 s)
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 1000);
export { now };

/** "2d 4h" · "3h 12m 5s" · "4m 9s" */
export function countdown(iso, at = now()) {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - at) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export const isLive = (r) => !!r && new Date(r.expiry).getTime() > now();

// ---------- Haken: { sortie: id|null, archon: id|null, nw: [challengeId] } ----------
// Sortie/Archon merken sich die ID der erledigten Runde – kommt eine neue, ist der Haken von selbst weg.
const EMPTY = { sortie: null, archon: null, nw: [] };
const [checks, setChecks] = createStore({ ...EMPTY });
export { checks };
let ready = false;
if (isTauri) {
  call('store_get', { key: 'worldchecks' })
    .then((stored) => stored && typeof stored === 'object' && setChecks({ ...EMPTY, ...stored }))
    .finally(() => (ready = true));
}

function set(next) {
  setChecks(reconcile(next));
  if (isTauri) call('store_set', { key: 'worldchecks', value: next }).catch(() => {});
}

export function toggleRound(kind, id) {
  set({ ...checks, nw: [...checks.nw], [kind]: checks[kind] === id ? null : id });
}

/** Nightwave-Herausforderung an/aus; alte IDs fallen dabei weg. */
export function toggleChallenge(id, activeIds) {
  const keep = new Set(activeIds);
  const nw = checks.nw.filter((x) => x !== id && keep.has(x));
  if (!checks.nw.includes(id)) nw.push(id);
  set({ ...checks, nw });
}

/** Haken abgelaufener Herausforderungen entfernen. */
export function pruneChallenges(activeIds) {
  if (!ready || !activeIds.length) return;
  const keep = new Set(activeIds);
  const nw = checks.nw.filter((x) => keep.has(x));
  if (nw.length !== checks.nw.length) set({ ...checks, nw });
}

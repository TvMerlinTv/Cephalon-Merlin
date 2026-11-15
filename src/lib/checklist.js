// Eigene Checkliste für tägliche und wöchentliche Aufgaben (checklist.json im Datenordner).
// Haken verfallen von selbst: täglich um 00:00 UTC, wöchentlich montags 00:00 UTC (wie im Spiel).
import { createStore, reconcile } from 'solid-js/store';
import { call, isTauri } from './ipc.js';

const DAY = 24 * 60 * 60 * 1000;

/** Kennzahl des laufenden Zeitraums: Tag seit 1970 bzw. Woche (Montag-Beginn). */
export function periodKey(kind, at) {
  const day = Math.floor(at / DAY);
  // Der 1.1.1970 war ein Donnerstag: +3 Tage verschiebt den Wochenanfang auf Montag
  return kind === 'weekly' ? Math.floor((day + 3) / 7) : day;
}

/** Zeitpunkt (ms) des nächsten Zurücksetzens. */
export function nextReset(kind, at) {
  const day = Math.floor(at / DAY);
  if (kind !== 'weekly') return (day + 1) * DAY;
  return ((Math.floor((day + 3) / 7) + 1) * 7 - 3) * DAY;
}

export const isDone = (state, task, at) => state.done?.[task.id] === periodKey(task.kind, at);

/** Haken setzen/entfernen; verfallene Einträge und Haken gelöschter Aufgaben fallen dabei weg. */
export function toggled(state, task, at) {
  const done = {};
  for (const t of state.tasks) if (t.id !== task.id && isDone(state, t, at)) done[t.id] = state.done[t.id];
  if (!isDone(state, task, at)) done[task.id] = periodKey(task.kind, at);
  return { ...state, done };
}

export const DEFAULT_TASKS = [
  { id: 'd-standing', kind: 'daily', text: 'Syndikats-Ansehen aufbrauchen' },
  { id: 'd-focus', kind: 'daily', text: 'Fokus-Tageslimit' },
  { id: 'd-incursions', kind: 'daily', text: 'Steel-Path-Incursionen' },
  { id: 'w-nightwave', kind: 'weekly', text: 'Nightwave-Wochenaufgaben' },
  { id: 'w-netracells', kind: 'weekly', text: 'Netracells' },
  { id: 'w-circuit', kind: 'weekly', text: 'Circuit-Belohnung wählen' },
  { id: 'w-kahl', kind: 'weekly', text: 'Kahl-Mission' },
  { id: 'w-ayatan', kind: 'weekly', text: 'Ayatan-Schatzsuche bei Maroo' },
  { id: 'w-teshin', kind: 'weekly', text: 'Teshins Steel-Essence-Angebot' },
];

const MAX_TASKS = 40;
const clean = (stored) => {
  const tasks = Array.isArray(stored?.tasks)
    ? stored.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && (t.kind === 'daily' || t.kind === 'weekly')).slice(0, MAX_TASKS)
    : DEFAULT_TASKS;
  return { tasks, done: stored?.done && typeof stored.done === 'object' ? stored.done : {} };
};

const [checklist, setStore] = createStore(clean(null));
export { checklist };
if (isTauri) call('store_get', { key: 'checklist' }).then((s) => s && setStore(reconcile(clean(s)))).catch(() => {});

function set(next) {
  setStore(reconcile(next));
  if (isTauri) call('store_set', { key: 'checklist', value: next }).catch(() => {});
}
const snapshot = () => ({ tasks: checklist.tasks.map((t) => ({ ...t })), done: { ...checklist.done } });

export const toggleTask = (task) => set(toggled(snapshot(), task, Date.now()));
export function addTask(kind, text) {
  const clean = text.trim().slice(0, 80);
  const s = snapshot();
  if (!clean || s.tasks.length >= MAX_TASKS) return false;
  set({ ...s, tasks: [...s.tasks, { id: `${kind[0]}-${Date.now().toString(36)}`, kind, text: clean, own: true }] });
  return true;
}
export function removeTask(id) {
  const s = snapshot();
  const done = { ...s.done };
  delete done[id];
  set({ tasks: s.tasks.filter((t) => t.id !== id), done });
}
export const resetTasks = () => set({ tasks: DEFAULT_TASKS, done: {} });

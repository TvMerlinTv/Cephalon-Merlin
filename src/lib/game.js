// Gemeinsamer Zustand: zuletzt geladenes Inventar + Sync-Status.
// Der Sync selbst läuft im Rust-Teil; jedes Fenster bekommt das Ergebnis per Ereignis.
import { createStore, reconcile } from 'solid-js/store';
import { call, isTauri, on } from './ipc.js';

const [game, setGame] = createStore({ inventory: null, syncing: false, error: null });
export { game };

if (isTauri) {
  call('game_last')
    .then((inv) => inv && setGame('inventory', reconcile(inv)))
    .catch(() => {});
  on('inventory-changed', (inv) => setGame('inventory', reconcile(inv)));
  // Auch Syncs, die nicht aus diesem Fenster kommen (später: Auto-Sync), zeigen den Status
  on('sync-state', (s) => setGame('syncing', s === 'start'));
  // Auto-Sync (Rust-Teil): Fehler nur am Sync-Knopf zeigen, kein Popup
  on('auto-sync', ({ state, message }) => {
    if (state === 'start') setGame('error', null);
    if (state === 'error') setGame('error', `Auto-Sync: ${message}`);
  });
}

async function run(cmd) {
  setGame({ syncing: true, error: null });
  try {
    const inv = await call(cmd);
    if (inv) setGame('inventory', reconcile(inv));
  } catch (e) {
    setGame('error', e.message ?? String(e));
  } finally {
    setGame('syncing', false);
  }
}

export const syncGame = () => run('game_sync');
export const importInventory = () => run('game_import');
export const clearSyncError = () => setGame('error', null);

/** Fertig vorhanden: gebaute Bauteile, Blaupausen/Teile im Inventar, eigene Ausrüstung, Rohstoffe. */
export function builtCount(inv, id) {
  if (!inv) return 0;
  return (inv.counts[id] ?? 0) + (inv.owned[id] ?? 0);
}

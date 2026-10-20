import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { game } from './api.js';

// Gemeinsamer Zustand: zuletzt geladenes Inventar + Sync-Status.
const Ctx = createContext(null);

export function GameDataProvider({ children }) {
  const [inventory, setInventory] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    game.last().then((inv) => inv && setInventory(inv)).catch(() => {});
  }, []);

  // Auto-Sync aus dem Main-Prozess: nur Badge-Zustand, Fehler ohne Popup
  useEffect(
    () =>
      window.wf?.onAutoSync?.(({ state, inventory: inv, message }) => {
        if (state === 'start') {
          setSyncing(true);
          setError(null);
        } else {
          setSyncing(false);
          if (state === 'done' && inv) setInventory(inv);
          if (state === 'error') setError(`Auto-Sync: ${message}`);
        }
      }),
    [],
  );

  const run = useCallback(async (fn) => {
    setSyncing(true);
    setError(null);
    try {
      const inv = await fn();
      if (inv) setInventory(inv);
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  const sync = useCallback(() => run(game.sync), [run]);
  const importFile = useCallback(() => run(game.importFile), [run]);
  // Zuletzt gespeichertes Inventar neu einlesen (z. B. im Overlay nach einem Sync im Hauptfenster)
  const reload = useCallback(() => game.last().then((inv) => inv && setInventory(inv)).catch(() => {}), []);

  return (
    <Ctx.Provider value={{ inventory, syncing, error, sync, importFile, reload, clearError: () => setError(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGameData() {
  return useContext(Ctx);
}

/** Fertig vorhanden: gebaute Bauteile, Blaupausen/Teile im Inventar, eigene Ausrüstung, Rohstoffe. */
export function builtCount(inv, id) {
  if (!inv) return 0;
  return (inv.counts[id] ?? 0) + (inv.owned[id] ?? 0);
}

/** Nur als Blaupause vorhanden: z. B. "Chassis-Blaupause" für ein noch nicht gebautes Chassis. */
export function blueprintOnlyCount(inv, id) {
  if (!inv || !id.endsWith('Component')) return 0;
  return inv.counts[id.replace(/Component$/, 'Blueprint')] ?? 0;
}

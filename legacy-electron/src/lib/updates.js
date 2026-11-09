import { useEffect, useState } from 'react';
import { isElectron } from './api.js';

// Zustand des Selbst-Updates (electron/updater.cjs), für Titelleiste und Hilfe/Info.
// Im Browser-Testmodus gibt es keine Updates; mit ?updateDemo in der Adresse zeigt
// die Entwicklungsversion einen nachgebauten Zustand, um die Oberfläche zu prüfen.

const DEMO =
  !isElectron && import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('updateDemo');

let demoState = {
  status: 'available',
  current: '0.1.0',
  repo: 'demo/cephalon-merlin',
  canInstall: true,
  latest: {
    version: '0.2.0',
    name: 'v0.2.0',
    notes: '## Neu\n- Selbst-Update über GitHub-Releases\n- Kleinere Verbesserungen\n\n## Behoben\n- Overlay erscheint wieder zuverlässig',
    url: 'https://github.com/',
    asset: { name: 'Cephalon.Merlin.exe', size: 80_000_000 },
    small: { size: 240_000 },
  },
};
const demoListeners = new Set();
const setDemo = (patch) => {
  demoState = { ...demoState, ...patch };
  for (const l of demoListeners) l(demoState);
};

export const updatesSupported = isElectron || DEMO;

export const updates = {
  state: () => (DEMO ? Promise.resolve(demoState) : window.wf.updateState()),
  check: () => {
    if (!DEMO) return window.wf.updateCheck();
    setDemo({ status: 'checking' });
    return new Promise((r) =>
      setTimeout(() => {
        setDemo({ status: 'available', checkedAt: Date.now() });
        r(demoState);
      }, 600),
    );
  },
  install: async () => {
    if (!DEMO) return window.wf.updateInstall();
    // Download-Fortschritt nachspielen, danach wieder zurück
    const total = demoState.latest.asset.size;
    for (let done = 0; done <= total; done += total / 20) {
      setDemo({ status: 'downloading', progress: { done, total } });
      await new Promise((r) => setTimeout(r, 80));
    }
    setDemo({ status: 'installing' });
    setTimeout(() => setDemo({ status: 'available', progress: null }), 1500);
    return true;
  },
  subscribe: (cb) => {
    if (!DEMO) return window.wf.onUpdate(cb);
    demoListeners.add(cb);
    return () => demoListeners.delete(cb);
  },
};

/** Aktueller Update-Zustand; null, solange er noch nicht geladen ist (oder im Browser). */
export function useUpdate() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!updatesSupported || (!DEMO && !window.wf.updateState)) return undefined;
    let alive = true;
    updates.state().then((s) => alive && setState(s)).catch(() => {});
    const off = updates.subscribe((s) => alive && setState(s));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return state;
}

export const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

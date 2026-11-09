import { useEffect, useMemo, useRef } from 'react';
import { isElectron, load, save } from './api.js';
import { useSettings } from './settings.js';
import { useGameData } from './GameData.jsx';
import { useMasteryDb } from './masteryDb.js';
import { translate } from './i18n.js';

// Foundry-Timer: laufende Bauaufträge aus dem letzten Sync (inventory.foundry, electron/inventory.cjs).
// Die Fertig-Zeit ist bekannt, daher klappt die Meldung auch Stunden nach dem Sync.

const STORE_KEY = 'foundry'; // im Datenordner (main.cjs STORE_KEYS), im Browser localStorage
const LOCAL_KEY = 'td.notify.foundry';
const KEEP_MS = 30 * 24 * 3600_000; // gemeldete Aufträge so lange merken

const keyOf = (b) => `${b.recipe}|${b.completesAt}`;

/** Bauaufträge mit Name/Bild; fehlt etwas (neuer Inhalt), hilft die Mastery-Datenbank aus. */
export function useFoundry() {
  const { inventory } = useGameData() ?? {};
  const { db } = useMasteryDb();
  const list = useMemo(
    () =>
      (inventory?.foundry ?? []).map((b) => {
        if (b.item && b.image) return b;
        const hit = db?.index.get(b.recipe) ?? (b.item ? db?.index.get(b.item) : null);
        if (!hit) return b;
        // Haupt-Blaupause ("Blueprint") baut das Item selbst, sonst das Bauteil
        const part = hit.part && hit.part.name !== 'Blueprint' ? hit.part : null;
        return {
          ...b,
          item: b.item ?? part?.id ?? hit.item.id,
          name: b.item ? b.name : part ? `${hit.item.name} ${part.name}` : hit.item.name,
          image: b.image ?? part?.image ?? hit.item.image,
        };
      }),
    [inventory, db],
  );
  return { list, syncedAt: inventory?.syncedAt ?? null };
}

function send(title, body) {
  try {
    if (Notification.permission === 'denied') return;
    new Notification(title, { body, silent: false });
  } catch {
    /* Benachrichtigungen nicht verfügbar */
  }
}

/** Meldet jeden fertigen Bauauftrag genau einmal (gemerkt im Datenordner). */
export function useFoundryNotifications(now) {
  const s = useSettings();
  const { list } = useFoundry();
  const sent = useRef(null); // Map key -> completesAt; null = noch nicht geladen

  useEffect(() => {
    let alive = true;
    const apply = (stored) => {
      if (!alive) return;
      sent.current = new Map(stored && typeof stored === 'object' ? Object.entries(stored) : []);
    };
    if (isElectron && window.wf.storeGet) window.wf.storeGet(STORE_KEY).then(apply, () => apply(null));
    else apply(load(LOCAL_KEY, null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!sent.current || !s.notify || !s.notifyFoundry) return;
    const done = list.filter((b) => b.completesAt && b.completesAt <= now && !sent.current.has(keyOf(b)));
    if (!done.length) return;
    for (const b of done) {
      sent.current.set(keyOf(b), b.completesAt);
      send(translate(s.language, 'Foundry: {name} ist fertig', { name: b.name }), translate(s.language, 'Kann in der Foundry abgeholt werden.'));
    }
    for (const [k, at] of sent.current) if (Number(at) < now - KEEP_MS) sent.current.delete(k);
    const obj = Object.fromEntries(sent.current);
    if (isElectron && window.wf.storeSet) window.wf.storeSet(STORE_KEY, obj).catch(() => {});
    else save(LOCAL_KEY, obj);
  }, [list, now, s]);
}

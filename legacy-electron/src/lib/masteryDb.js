import { useEffect, useState } from 'react';
import { game, getItems } from './api.js';

// Mastery-Datenbank (WFCD) einmal laden und überall teilen.
let dbPromise = null;
export function loadMasteryDb() {
  dbPromise ??= game.masteryDb().then(withIndex).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Index: Item- oder Bauteil-ID (auch die Blaupausen-Variante) -> { item, part } */
function withIndex(db) {
  const index = new Map();
  for (const item of db.items) {
    index.set(item.id, { item, part: null });
    for (const part of item.components) {
      if (part.kind !== 'part') continue;
      for (const id of [part.id, part.id.replace(/Component$/, 'Blueprint')]) {
        if (!index.has(id)) index.set(id, { item, part });
      }
    }
  }
  return { ...db, index };
}

export function useMasteryDb() {
  const [state, setState] = useState({ db: null, error: null });
  useEffect(() => {
    loadMasteryDb()
      .then((db) => setState({ db, error: null }))
      .catch((e) => setState({ db: null, error: e.message }));
  }, []);
  return state;
}

/** warframe.market-Item zu einer Spiel-ID (Bauteile werden dort als Blaupause gehandelt). */
let marketByRef = null;
export async function marketItemFor(id) {
  if (!marketByRef) {
    const items = await getItems();
    marketByRef = new Map(items.filter((i) => i.gameRef).map((i) => [i.gameRef, i]));
  }
  return marketByRef.get(id) ?? marketByRef.get(id.replace(/Component$/, 'Blueprint')) ?? null;
}

/** Wiki-Seite zu einem Namen ("Bronco Prime" -> …/w/Bronco_Prime) */
export function wikiFor(name) {
  return `https://wiki.warframe.com/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;
}

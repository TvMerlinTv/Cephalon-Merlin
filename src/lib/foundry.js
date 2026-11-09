// Foundry-Timer: laufende Bauaufträge aus dem letzten Sync (inventory.foundry, Rust: game/summary.rs).
// Die Fertig-Meldung schickt der Rust-Teil (notify.rs). Hier nur: Name/Bild ergänzen, falls neu.
import { createMemo, createResource } from 'solid-js';
import { game } from './game.js';
import { loadMasteryDb } from './gamedb.js';

export function createFoundry() {
  const [db] = createResource(() => loadMasteryDb().catch(() => null));
  const list = createMemo(() =>
    (game.inventory?.foundry ?? []).map((b) => {
      if (b.item && b.image) return b;
      const d = db();
      const hit = d?.index.get(b.recipe) ?? (b.item ? d?.index.get(b.item) : null);
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
  );
  return { list, syncedAt: () => game.inventory?.syncedAt ?? null };
}

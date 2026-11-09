import { useEffect, useMemo, useState } from 'react';
import { game, getItems, getBulkPrices } from './api.js';
import { useGameData, builtCount, blueprintOnlyCount } from './GameData.jsx';
import { useMasteryDb } from './masteryDb.js';
import { useTodo } from './todo.js';
import { expectedValue } from './relicMath.js';

let relicPromise = null;
const loadRelics = () => (relicPromise ??= game.relicDb().catch((e) => ((relicPromise = null), Promise.reject(e))));

/**
 * Alles, was das Overlay zu einem Relikt-Teil wissen muss:
 * Preis, Ducats, wie viele du hast, ob dir das Item für Mastery fehlt, Set-Teile und Set-Preis.
 */
export function useRewardInfo() {
  const { inventory } = useGameData();
  const { db: mastery } = useMasteryDb();
  const todo = useTodo();
  const [data, setData] = useState(null);

  useEffect(() => {
    Promise.all([loadRelics(), getItems(), getBulkPrices()])
      .then(([relicDb, items, prices]) => {
        // Teilname -> { id, slug } aus allen Relikten
        const rewards = new Map();
        for (const r of relicDb.relics) for (const w of r.rewards.intact ?? []) rewards.set(w.name, w);
        setData({ relicDb, prices, market: new Map(items.map((i) => [i.slug, i])), rewards });
      })
      .catch(() => {});
  }, []);

  return useMemo(() => {
    if (!data) return { ready: false };
    const { relicDb, prices, market, rewards } = data;
    const priceOf = (name) => prices[name.toLowerCase()] ?? null;

    // Waffen, die selbst Bauteil einer anderen sind (Lex Prime -> Aklex Prime, 2x Bronco Prime -> Akbronco Prime)
    const usedIn = new Map();
    for (const it of mastery?.items ?? []) {
      for (const c of it.components) {
        if (c.kind !== 'part' || c.id.includes('/Recipes/')) continue;
        if (!usedIn.has(c.id)) usedIn.set(c.id, []);
        usedIn.get(c.id).push({ item: it, count: c.count });
      }
    }
    const isDone = (it) => (inventory?.xp[it.id] ?? 0) >= it.maxXp || (inventory?.owned[it.id] ?? 0) > 0;
    /** Wird diese Waffe noch für ein anderes, nicht fertiges Item gebraucht (und hast du nicht genug)? */
    const neededFor = (it) =>
      (usedIn.get(it.id) ?? []).find(({ item: parent, count }) => !isDone(parent) && (inventory?.owned[it.id] ?? 0) < count)?.item ??
      null;

    const info = (name) => {
      const reward = rewards.get(name) ?? { name };
      const m = reward.slug ? market.get(reward.slug) : null;
      const entry = reward.id ? mastery?.index.get(reward.id) : null;
      const item = entry?.item ?? null;
      const part = entry?.part ?? null;
      // Gebautes Bauteil + seine Blaupause (Relikte droppen die Blaupause, das Set braucht das Bauteil)
      const have = part
        ? builtCount(inventory, part.id) + blueprintOnlyCount(inventory, part.id)
        : reward.id
          ? builtCount(inventory, reward.id)
          : 0;
      const need = part?.count ?? 1;
      const mastered = item ? (inventory?.xp[item.id] ?? 0) >= item.maxXp : false;
      const itemOwned = item ? (inventory?.owned[item.id] ?? 0) > 0 : false;

      // Gemeistert/im Besitz, aber für eine Akimbo-/Kombi-Waffe noch einmal nötig?
      const parent = item && (mastered || itemOwned) ? neededFor(item) : null;

      let status = 'none';
      if (/forma blueprint$/i.test(name)) status = 'forma';
      else if (!item) status = 'none';
      else if (parent) status = 'need';
      else if (mastered) status = 'mastered';
      else if (itemOwned) status = 'owned';
      else if (have >= need) status = 'have';
      else status = 'need';

      const setParts = item
        ? item.components
            .filter((c) => c.kind === 'part')
            .map((c) => ({ ...c, have: builtCount(inventory, c.id) + blueprintOnlyCount(inventory, c.id) }))
        : [];

      return {
        name,
        plat: priceOf(name),
        ducats: m?.ducats ?? 0,
        have,
        need,
        status,
        item,
        neededFor: parent?.name ?? null,
        partId: part?.id ?? null,
        vaulted: item?.vaulted ?? null,
        setParts,
        setPrice: item ? priceOf(`${item.name} Set`) : null,
        onTodo: item ? todo.includes(item.id) : false,
      };
    };

    /** Bestes Teil aus einer Auswahl: was dir für Mastery fehlt, sonst das wertvollste. */
    const pick = (infos) => {
      const rank = (i) => (i.status === 'need' ? 1e6 : 0) + (i.onTodo ? 1e5 : 0) + (i.plat ?? 0) * 10 + i.ducats / 100;
      return infos.reduce((best, i) => (rank(i) > rank(best) ? i : best), infos[0]);
    };

    const relicById = (id) => relicDb.relics.find((r) => r.id === id) ?? null;

    /**
     * Wie viele Belohnungen eines Relikts sind für dich erledigt (gemeistert / Waffe im Besitz)?
     * Forma und Nicht-Mastery-Items zählen nicht mit.
     */
    const relicProgress = (relicId) => {
      const relic = relicById(relicId);
      const infos = (relic?.rewards.intact ?? []).map((w) => info(w.name)).filter((i) => i.status !== 'forma' && i.status !== 'none');
      return { done: infos.filter((i) => i.status === 'mastered' || i.status === 'owned').length, total: infos.length };
    };

    /**
     * Beste eigene Relikte (optional nur einer Ära), jede Veredelungsstufe einzeln –
     * sortiert nach erwartetem Platin-Gewinn im Squad.
     */
    const recommend = ({ squad = 4, tier = null, limit = 6 } = {}) => {
      const rows = [];
      let total = 0;
      for (const r of relicDb.relics) {
        if (tier && r.tier !== tier) continue;
        const counts = inventory?.relics?.[r.id];
        if (!counts) continue;
        for (const [refinement, count] of Object.entries(counts)) {
          if (!count) continue;
          total += count;
          const rw = r.rewards[refinement] ?? r.rewards.intact ?? [];
          rows.push({
            relic: r,
            refinement,
            count,
            plat: expectedValue(rw, (w) => priceOf(w.name) ?? 0, squad),
            ducats: expectedValue(rw, (w) => market.get(w.slug)?.ducats ?? 0, squad),
            needed: rw.filter((w) => info(w.name).status === 'need').length,
          });
        }
      }
      rows.sort((a, b) => b.plat - a.plat || b.ducats - a.ducats);
      return { list: rows.slice(0, limit), total };
    };

    return { ready: true, info, pick, relicById, relicProgress, recommend, priceOf, player: inventory?.player ?? null };
  }, [data, mastery, inventory, todo]);
}

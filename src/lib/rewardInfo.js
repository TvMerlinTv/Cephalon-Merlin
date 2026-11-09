// Alles, was Overlay und Relikt-Seiten zu einem Relikt-Teil wissen müssen:
// Preis, Ducats, wie viele du hast, ob dir das Item für Mastery fehlt, Set-Teile und Set-Preis.
import { createMemo, createResource } from 'solid-js';
import { game } from './game.js';
import { getItems } from './market.js';
import { loadMasteryDb, loadRelicDb, loadBulkPrices, builtCount, blueprintOnlyCount, todo, expectedValue } from './gamedb.js';

let basePromise = null;
function loadBase() {
  basePromise ??= Promise.all([loadRelicDb(), getItems(), loadBulkPrices(), loadMasteryDb().catch(() => null)])
    .then(([relicDb, items, prices, mastery]) => {
      const rewards = new Map();
      for (const r of relicDb.relics) for (const w of r.rewards.intact ?? []) rewards.set(w.name, w);
      const relicMap = new Map(relicDb.relics.map((r) => [r.id, r]));
      return { relicDb, relicMap, prices, market: new Map(items.map((i) => [i.slug, i])), rewards, mastery };
    })
    .catch((e) => {
      basePromise = null;
      throw e;
    });
  return basePromise;
}

/** Reaktiv: liefert ri() = { ready, info, pick, relicById, relicProgress, recommend, priceOf, player } */
export function createRewardInfo() {
  const [base] = createResource(loadBase);
  return createMemo(() => {
    const data = base();
    const inventory = game.inventory;
    const todoIds = todo();
    if (!data) return { ready: false, error: base.error?.message };
    const { relicDb, relicMap, prices, market, rewards, mastery } = data;
    const priceOf = (name) => prices[name.toLowerCase()] ?? null;

    // Waffen, die selbst Bauteil einer anderen sind (Lex Prime -> Aklex Prime)
    const usedIn = new Map();
    for (const it of mastery?.items ?? []) {
      for (const c of it.components) {
        if (c.kind !== 'part' || c.id.includes('/Recipes/')) continue;
        if (!usedIn.has(c.id)) usedIn.set(c.id, []);
        usedIn.get(c.id).push({ item: it, count: c.count });
      }
    }
    const isDone = (it) => (inventory?.xp[it.id] ?? 0) >= it.maxXp || (inventory?.owned[it.id] ?? 0) > 0;
    const neededFor = (it) =>
      (usedIn.get(it.id) ?? []).find(({ item: parent, count }) => !isDone(parent) && (inventory?.owned[it.id] ?? 0) < count)?.item ?? null;

    const cache = new Map();
    const info = (name) => {
      if (cache.has(name)) return cache.get(name);
      const reward = rewards.get(name) ?? { name };
      const m = reward.slug ? market.get(reward.slug) : null;
      const entry = reward.id ? mastery?.index.get(reward.id) : null;
      const item = entry?.item ?? null;
      const part = entry?.part ?? null;
      const have = part
        ? builtCount(inventory, part.id) + blueprintOnlyCount(inventory, part.id)
        : reward.id
          ? builtCount(inventory, reward.id)
          : 0;
      const need = part?.count ?? 1;
      const mastered = item ? (inventory?.xp[item.id] ?? 0) >= item.maxXp : false;
      const itemOwned = item ? (inventory?.owned[item.id] ?? 0) > 0 : false;
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
        ? item.components.filter((c) => c.kind === 'part').map((c) => ({ ...c, have: builtCount(inventory, c.id) + blueprintOnlyCount(inventory, c.id) }))
        : [];
      const out = {
        name,
        plat: priceOf(name),
        ducats: m?.ducats ?? 0,
        thumb: m?.thumb ?? null,
        slug: reward.slug ?? null,
        have,
        need,
        status,
        item,
        neededFor: parent?.name ?? null,
        partId: part?.id ?? null,
        vaulted: item?.vaulted ?? null,
        setParts,
        setPrice: item ? priceOf(`${item.name} Set`) : null,
        onTodo: item ? todoIds.includes(item.id) : false,
      };
      cache.set(name, out);
      return out;
    };

    /** Bestes Teil aus einer Auswahl: was dir für Mastery fehlt, sonst das wertvollste. */
    const pick = (infos) => {
      const rank = (i) => (i.status === 'need' ? 1e6 : 0) + (i.onTodo ? 1e5 : 0) + (i.plat ?? 0) * 10 + i.ducats / 100;
      return infos.reduce((best, i) => (rank(i) > rank(best) ? i : best), infos[0]);
    };

    const relicById = (id) => relicMap.get(id) ?? null;

    const relicProgress = (relicId) => {
      const relic = relicById(relicId);
      const infos = (relic?.rewards.intact ?? []).map((w) => info(w.name)).filter((i) => i.status !== 'forma' && i.status !== 'none');
      return { done: infos.filter((i) => i.status === 'mastered' || i.status === 'owned').length, total: infos.length };
    };

    /** Beste eigene Relikte (optional nur einer Ära), jede Veredelung einzeln, nach erwartetem Platin. */
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

    return { ready: true, info, pick, relicById, relicProgress, recommend, priceOf, relicDb, market, mastery, player: inventory?.player ?? null };
  });
}

// Startseite „Heute": Auswertungen (reine Funktionen, getestet in core.test.js).
import { evaluate } from './gamedb.js';

/**
 * Prime-Items, denen nur noch wenige Teile fehlen (weder gemeistert noch im Besitz).
 * -> [{ item, have, total, missing: [{ id, name, image, lack }] }], am weitesten fertige zuerst.
 * `skip(item)` blendet Items aus (z. B. Founders).
 */
export function nearlyComplete(db, inv, { maxMissing = 2, limit = 8, skip = () => false } = {}) {
  if (!db || !inv) return [];
  const out = [];
  for (const item of db.items) {
    if (!item.isPrime || skip(item)) continue;
    const ev = evaluate(item, inv);
    if (ev.status !== 'missing') continue;
    const total = ev.parts.reduce((s, p) => s + p.count, 0);
    const have = ev.parts.reduce((s, p) => s + Math.min(p.count, p.built + p.bp), 0);
    const missing = ev.parts.filter((p) => p.built + p.bp < p.count).map((p) => ({ id: p.id, name: p.name, image: p.image, lack: p.count - p.built - p.bp }));
    const lack = total - have;
    if (!total || have === 0 || lack < 1 || lack > maxMissing) continue;
    out.push({ item, have, total, missing });
  }
  return out.sort((a, b) => a.total - a.have - (b.total - b.have) || b.have / b.total - a.have / a.total || a.item.name.localeCompare(b.item.name)).slice(0, limit);
}

/** Baro oder Verkaufen? Ab 10 Ducats pro Platin lohnt Baro mehr; ohne Preis keine Empfehlung. */
export function tradeTip(ducats, plat) {
  if (!ducats || !plat) return null;
  return ducats / plat >= 10 ? 'baro' : 'sell';
}

/**
 * Farm-Plan für die fehlenden Teile fast fertiger Sets.
 * sets = Ergebnis von nearlyComplete; relics = Relikt-Datenbank; owned = inventory.relics ({ id: { intact: n, … } });
 * activeTiers = Set der Ären mit laufender Spalte.
 * -> [{ item, part, relics: [{ id, name, tier, owned, chance, active }], sources: [name…], active }]
 *    relics = eigene Relikte mit diesem Teil (aktive Ära zuerst, dann höchste Chance);
 *    sources = nicht im Vault liegende Relikte, falls du keins besitzt.
 */
export function farmPlan(sets, relics, owned, activeTiers, limit = 6) {
  if (!relics?.length) return [];
  const out = [];
  for (const set of sets) {
    for (const part of set.missing) {
      const ids = new Set([part.id, part.id.replace(/Component$/, 'Blueprint')]);
      const mine = [];
      const sources = [];
      for (const relic of relics) {
        const reward = (relic.rewards?.intact ?? []).find((w) => ids.has(w.id));
        if (!reward) continue;
        const count = Object.values(owned?.[relic.id] ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
        if (count > 0) mine.push({ id: relic.id, name: relic.name, tier: relic.tier, owned: count, chance: reward.chance, active: activeTiers.has(relic.tier) });
        else if (!relic.vaulted) sources.push(relic.name);
      }
      mine.sort((a, b) => b.active - a.active || b.chance - a.chance || b.owned - a.owned || a.name.localeCompare(b.name));
      out.push({ item: set.item, part, relics: mine.slice(0, 4), sources: sources.slice(0, 3), active: mine.some((r) => r.active) });
    }
  }
  // zuerst, was sich jetzt sofort öffnen lässt, dann was man besitzt, dann der Rest
  return out.sort((a, b) => b.active - a.active || (b.relics.length > 0) - (a.relics.length > 0)).slice(0, limit);
}

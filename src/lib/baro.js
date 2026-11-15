// Baros Angebot auswerten (reine Funktionen, getestet in core.test.js).

/** "/Lotus/…/PrimedContinuityMod" -> "Primed Continuity Mod" – Notlösung, wenn kein richtiger Name bekannt ist. */
export function prettyId(id) {
  const last = id.split('/').pop() ?? id;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/**
 * items = world.baro.items; byRef = Map Spiel-ID -> warframe.market-Item; index = Mastery-Index; inv = Inventar.
 * -> [{ id, name, known, image, ducats, credits, owned, affordable }]
 *    known = richtiger Name gefunden; sortiert: noch nicht im Besitz zuerst, dann bekannte Namen, dann teuerste.
 */
export function baroOffer(items, byRef, index, inv) {
  const wallet = inv?.player ?? null;
  return (items ?? [])
    .map((it) => {
      const m = byRef?.get(it.id) ?? null;
      const e = index?.get(it.id) ?? null;
      const name = m?.name ?? (e ? (e.part ? `${e.item.name} ${e.part.name}` : e.item.name) : null);
      const owned = inv ? (inv.counts?.[it.id] ?? 0) + (inv.owned?.[it.id] ?? 0) : 0;
      return {
        id: it.id,
        name: name ?? prettyId(it.id),
        known: !!name,
        image: m?.thumb ?? e?.part?.image ?? e?.item?.image ?? null,
        ducats: it.ducats,
        credits: it.credits,
        owned,
        affordable: wallet ? (wallet.ducats ?? 0) >= it.ducats && (wallet.credits ?? 0) >= it.credits : null,
      };
    })
    .sort((a, b) => (a.owned > 0) - (b.owned > 0) || b.known - a.known || b.ducats - a.ducats || a.name.localeCompare(b.name));
}

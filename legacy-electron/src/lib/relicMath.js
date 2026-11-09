/**
 * Erwarteter Wert, wenn `squad` Spieler dasselbe Relikt öffnen und jeder das beste
 * der gezogenen Teile nimmt (Radshare): E[max] über alle Belohnungen.
 */
export function expectedValue(rewards, valueOf, squad) {
  const sorted = rewards.map((r) => ({ v: valueOf(r), p: r.chance / 100 })).sort((a, b) => b.v - a.v);
  let better = 0;
  let ev = 0;
  for (const { v, p } of sorted) {
    ev += v * ((1 - better) ** squad - (1 - better - p) ** squad);
    better += p;
  }
  return ev;
}

export function rarityOf(chance) {
  if (chance <= 10) return 'rare';
  if (chance <= 20) return 'uncommon';
  return 'common';
}

import { builtCount, blueprintOnlyCount } from './GameData.jsx';

/**
 * Mastery- und Bau-Status eines Items.
 * - mastered:   Max-Rang erreicht
 * - leveling:   besitzt man oder hat schon XP
 * - buildable:  alle Bauteile fertig gebaut + alle Rohstoffe + genug Credits
 * - blueprints: alle Blaupausen/Teile da, aber Rohstoffe fehlen oder Bauteile sind noch zu bauen
 * - missing:    es fehlen Blaupausen oder Teile
 */
export function evaluate(item, inv) {
  const xp = inv?.xp[item.id] ?? 0;
  const perRank = item.maxXp / (item.maxRank * item.maxRank);
  const rank = Math.min(item.maxRank, Math.floor(Math.sqrt(xp / perRank)));
  const owned = (inv?.owned[item.id] ?? 0) > 0;

  const parts = item.components
    .filter((c) => c.kind === 'part')
    .map((c) => ({ ...c, built: builtCount(inv, c.id), bp: blueprintOnlyCount(inv, c.id) }));
  const resources = item.components
    .filter((c) => c.kind === 'resource')
    .map((c) => ({ ...c, built: builtCount(inv, c.id), bp: 0 }));

  const partsComplete = parts.length > 0 && parts.every((p) => p.built + p.bp >= p.count);
  const allBuilt = parts.every((p) => p.built >= p.count);
  const resourcesOk = resources.every((r) => r.built >= r.count);
  const creditsOk = (inv?.player.credits ?? 0) >= (item.credits ?? 0);

  let status;
  if (xp >= item.maxXp) status = 'mastered';
  else if (owned || xp > 0) status = 'leveling';
  else if (partsComplete && allBuilt && resourcesOk && creditsOk) status = 'buildable';
  else if (partsComplete) status = 'blueprints';
  else status = 'missing';

  return { item, xp, rank, owned, parts, resources, status, creditsOk };
}

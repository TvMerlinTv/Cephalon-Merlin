// Verlauf fürs Statistik-Panel: bei jedem Sync ein Schnappschuss der Kontowerte in stats.json.
const path = require('node:path');
const fs = require('node:fs/promises');

const file = (dataDir) => path.join(dataDir, 'stats.json');
const MERGE_MS = 10 * 60 * 1000; // Syncs kurz hintereinander ersetzen den letzten Punkt
const MAX_POINTS = 5000;

const KUVA = '/Lotus/Types/Items/MiscItems/Kuva';

/** Kennzahlen aus der Inventar-Zusammenfassung (summarizeInventory). */
function snapshotOf(summary) {
  const p = summary.player ?? {};
  const relics = Object.values(summary.relics ?? {}).reduce(
    (sum, byRef) => sum + Object.values(byRef).reduce((a, b) => a + b, 0),
    0,
  );
  return {
    t: summary.syncedAt ?? Date.now(),
    platinum: p.platinum ?? null,
    credits: p.credits ?? null,
    endo: p.endo ?? null,
    ducats: p.ducats ?? null,
    kuva: summary.counts?.[KUVA] ?? 0,
    mr: p.mr ?? null,
    relics,
    rivens: summary.rivens?.list?.length ?? p.rivens ?? 0,
    gear: Object.keys(summary.owned ?? {}).length,
  };
}

async function loadHistory(dataDir) {
  try {
    const list = JSON.parse(await fs.readFile(file(dataDir), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function recordSnapshot(dataDir, summary) {
  const point = snapshotOf(summary);
  const list = await loadHistory(dataDir);
  const last = list[list.length - 1];
  if (last && point.t - last.t < MERGE_MS) list[list.length - 1] = point;
  else list.push(point);
  await fs.writeFile(file(dataDir), JSON.stringify(list.slice(-MAX_POINTS)), 'utf8');
  return list;
}

/** Verlauf; ohne Einträge den zuletzt gespeicherten Inventar-Stand als ersten Punkt nehmen. */
async function getHistory(dataDir, lastSummary) {
  const list = await loadHistory(dataDir);
  if (list.length || !lastSummary) return list;
  return recordSnapshot(dataDir, lastSummary);
}

module.exports = { recordSnapshot, getHistory, snapshotOf };

// Belohnungs-Log: nach jeder Spalten-Mission die (bis zu) 4 Belohnungen zur Wahl in reward-log.json.
// Platin/Ducats rechnet die Oberfläche mit aktuellen Preisen aus – gespeichert werden nur die Namen.
const path = require('node:path');
const fs = require('node:fs/promises');

const file = (dataDir) => path.join(dataDir, 'reward-log.json');
const SAME_MS = 5 * 60 * 1000; // gleicher Bildschirm (mehrere Scans / Pos1) innerhalb von 5 Min. = ein Eintrag
const MAX_RUNS = 5000;

async function loadRuns(dataDir) {
  try {
    const list = JSON.parse(await fs.readFile(file(dataDir), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Schreibvorgänge nacheinander, damit sich zwei Scans kurz hintereinander nicht überschreiben
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const key = (names) => [...names].sort().join('|');

/**
 * Ergebnis eines Belohnungs-Scans (screenScan analyze, mode 'rewards') speichern.
 * @param result  { mode: 'rewards', items: [{ name }], at }
 * @param relic   zuletzt in der Relikt-Auswahl angeklicktes Relikt { id, name, refinement } oder null
 * @returns den gespeicherten/aktualisierten Eintrag oder null
 */
function recordRewards(dataDir, result, relic = null) {
  const names = (result?.items ?? []).map((i) => i?.name).filter((n) => typeof n === 'string' && n);
  if (result?.mode !== 'rewards' || !names.length) return Promise.resolve(null);
  const t = result.at ?? Date.now();
  return serial(async () => {
    const list = await loadRuns(dataDir);
    const k = key(names);
    // Derselbe Bildschirm: gleiche Namen – oder ein Scan, der nur einen Teil davon gelesen hat
    // (Teilmenge erst ab 2 Namen, ein einzelnes „Forma Blueprint“ passt sonst zu jedem Run)
    const subset = (a, b) => a.length >= 2 && a.every((n) => b.includes(n));
    const prev = list.findLast((r) => Math.abs(t - r.t) < SAME_MS && (key(r.items) === k || subset(names, r.items) || subset(r.items, names)));
    let entry;
    if (prev) {
      // Mehr erkannte Namen ersetzen die unvollständige Liste
      if (names.length > prev.items.length) prev.items = names;
      if (!prev.relic && relic) prev.relic = relic;
      entry = prev;
    } else {
      entry = { id: `${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`, t, items: names, chosen: null, relic: relic ?? null };
      list.push(entry);
    }
    await fs.writeFile(file(dataDir), JSON.stringify(list.slice(-MAX_RUNS)), 'utf8');
    return entry;
  });
}

/** Gewählte Belohnung von Hand setzen (null = unbekannt) – die Erkennung sieht die Wahl nicht. */
function setChoice(dataDir, id, chosen) {
  return serial(async () => {
    const list = await loadRuns(dataDir);
    const run = list.find((r) => r.id === id);
    if (!run) return null;
    run.chosen = typeof chosen === 'string' && run.items.includes(chosen) ? chosen : null;
    await fs.writeFile(file(dataDir), JSON.stringify(list), 'utf8');
    return run;
  });
}

/** Eintrag löschen (Fehlerkennung). */
function removeRun(dataDir, id) {
  return serial(async () => {
    const list = await loadRuns(dataDir);
    const next = list.filter((r) => r.id !== id);
    await fs.writeFile(file(dataDir), JSON.stringify(next), 'utf8');
    return next.length !== list.length;
  });
}

module.exports = { recordRewards, setChoice, removeRun, loadRuns, SAME_MS };

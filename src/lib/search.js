// Globale Suche (Strg+K): Rangfolge der Treffer. Reine Funktionen, getestet in core.test.js.

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** 0 = kein Treffer; höher = besser (Anfang des Namens > Wortanfang > irgendwo). Alle Suchwörter müssen vorkommen. */
export function matchScore(name, query) {
  const n = norm(name);
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = 0;
  for (const w of words) {
    const i = n.indexOf(w);
    if (i < 0) return 0;
    score += i === 0 ? 30 : /[\s\-(/]/.test(n[i - 1]) ? 20 : 10;
  }
  if (n === words.join(' ')) score += 50;
  return score - Math.min(9, n.length / 12); // kürzere Namen leicht bevorzugen
}

/** Beste `limit` Einträge aus `list` (jeweils mit `name`), nach Punktzahl. */
export function searchList(list, query, limit = 8) {
  const hits = [];
  for (const entry of list) {
    const score = matchScore(entry.name, query);
    if (score > 0) hits.push({ entry, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((h) => h.entry);
}

// Positionen der 6 Belohnungen im "Possible Rewards"-Feld der Relikt-Auswahl.
//
// Das Spiel zeigt sie immer als 3×2-Raster: oben die 3 häufigen (25 %), unten 2 seltenere (11 %)
// und rechts unten das seltenste (2 %). Erkennt die OCR einen Namen nicht (Text über dem Item-Bild),
// setzen wir das Schild trotzdem in die passende Zelle.

// Gemessen an 2000×837 (Ultrawide), relativ zur Bildhöhe:
const COL_X = [0.094, 0.259, 0.425]; // Zellmitte, ab linkem Rand des Titels
const ROW_Y = [0.194, 0.386]; // Unterkante der Namen, ab Oberkante von "Possible"
const GROUPS = [
  [0, 1, 2],
  [3, 4],
  [5],
];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * @returns [{ name, x, y, guessed }] – x = Mitte, y = Oberkante des Schilds (Bildschirm-Pixel)
 */
export function rewardCells(result, relic) {
  const H = result.screen?.height ?? 1080;
  const rewards = [...(relic.rewards[result.refinement] ?? relic.rewards.intact ?? [])].sort((a, b) => b.chance - a.chance);
  const spots = result.spots ?? [];
  const canTemplate = result.anchor && Number.isFinite(result.titleLeft);

  // Ohne Titel-Position nur das, was die OCR gefunden hat
  if (!canTemplate) {
    const tip = result.tooltip;
    return spots
      .map((s) => ({ name: s.name, x: s.x + s.w / 2, y: s.y + s.h + 4, guessed: false }))
      .filter((p) => !tip || p.x < tip.x || p.x > tip.x + tip.w || p.y < tip.y || p.y > tip.y + tip.h);
  }

  const colX = COL_X.map((f) => result.titleLeft + f * H);
  const rowY = ROW_Y.map((f) => result.anchor.y + f * H);
  const cellOf = (i) => ({ c: i % 3, r: Math.floor(i / 3) });

  // Erkannte Namen ihrer Zelle zuordnen
  const placed = new Map(); // Zellindex -> { name, x, y }
  for (const s of spots) {
    const cx = s.x + s.w / 2;
    const by = s.y + s.h;
    let best = -1;
    let dist = Infinity;
    for (let i = 0; i < 6; i++) {
      const { c, r } = cellOf(i);
      const d = Math.hypot(colX[c] - cx, (rowY[r] - by) * 1.5);
      if (d < dist && !placed.has(i)) {
        dist = d;
        best = i;
      }
    }
    if (best >= 0) placed.set(best, { name: s.name, x: cx, y: by + 4, guessed: false });
  }

  // Raster mit den gefundenen Positionen nachjustieren
  for (let c = 0; c < 3; c++) {
    const xs = [...placed].filter(([i]) => cellOf(i).c === c).map(([, p]) => p.x);
    if (xs.length) colX[c] = median(xs);
  }
  for (let r = 0; r < 2; r++) {
    const ys = [...placed].filter(([i]) => cellOf(i).r === r).map(([, p]) => p.y - 4);
    if (ys.length) rowY[r] = median(ys);
  }

  // Fehlende Namen in freie Zellen ihrer Seltenheits-Gruppe setzen
  const found = new Set([...placed.values()].map((p) => p.name));
  let offset = 0;
  for (const group of GROUPS) {
    const names = rewards.slice(offset, offset + group.length).map((w) => w.name);
    offset += group.length;
    const free = group.filter((i) => !placed.has(i));
    const missing = names.filter((n) => !found.has(n));
    missing.forEach((name, k) => {
      const i = free[k];
      if (i === undefined) return;
      const { c, r } = cellOf(i);
      placed.set(i, { name, x: colX[c], y: rowY[r] + 4, guessed: true });
    });
  }
  // Vom Hover-Tooltip des Spiels verdeckte Zellen auslassen – sonst lägen die Schilder auf dem Tooltip
  const tip = result.tooltip;
  const covered = (p) => tip && p.x >= tip.x && p.x <= tip.x + tip.w && p.y >= tip.y && p.y <= tip.y + tip.h;
  return [...placed.values()].filter((p) => !covered(p));
}

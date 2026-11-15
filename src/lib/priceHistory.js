// Auswertung des Preisverlaufs (reine Funktionen, getestet in core.test.js).

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/**
 * [{ median, volume }] (älteste zuerst) -> Kennzahlen oder null bei zu wenig Daten.
 * Trend: Durchschnitt der letzten 7 Tage gegen die 7 Tage davor; unter 5 % gilt als stabil.
 * hint: ob der Preis gerade im oberen oder unteren Fünftel der Spanne liegt.
 */
export function priceTrend(points) {
  const medians = points.map((p) => p.median).filter((n) => Number.isFinite(n));
  if (medians.length < 4) return null;
  const min = Math.min(...medians);
  const max = Math.max(...medians);
  const recent = medians.slice(-7);
  const before = medians.slice(-14, -7);
  const now = mean(recent);
  const change = before.length ? Math.round(((now - mean(before)) / mean(before)) * 100) : 0;
  const dir = Math.abs(change) < 5 ? 'flat' : change > 0 ? 'up' : 'down';
  const pos = max > min ? (now - min) / (max - min) : 0.5;
  const hint = max - min < 2 ? null : pos >= 0.8 ? 'Gerade hoch – guter Moment zum Verkaufen.' : pos <= 0.2 ? 'Gerade niedrig – guter Moment zum Kaufen.' : null;
  const volumes = points.map((p) => p.volume).filter((n) => Number.isFinite(n));
  return { days: medians.length, min: round1(min), max: round1(max), avg: round1(mean(medians)), change, dir, hint, volume: volumes.length ? Math.round(mean(volumes)) : 0 };
}

/** Werte -> SVG-Pfad ("M0 12 L4 10 …") in einem w×h-Feld, oben = höchster Wert. */
export function sparkPath(values, w, h, pad = 3) {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const span = Math.max(...v) - min || 1;
  return v.map((n, i) => `${i ? 'L' : 'M'}${round1((i / (v.length - 1)) * w)} ${round1(h - pad - ((n - min) / span) * (h - 2 * pad))}`).join(' ');
}

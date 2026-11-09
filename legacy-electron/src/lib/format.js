/** "3h 34m 28s" bzw. "57m 47s" bis zum Zeitpunkt `iso`. */
export function countdown(iso, now = Date.now()) {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

/** 1500 -> "1.5K", 2000000 -> "2M" */
export function compact(n) {
  if (n == null) return '–';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(n);
}

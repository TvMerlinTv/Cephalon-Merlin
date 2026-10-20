import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Coins, Hexagon, Flame, Dices, Swords, ChevronsUp, Table2, LineChart, Droplet, Gift } from 'lucide-react';
import { useGameData } from '../lib/GameData.jsx';
import { game, load, save } from '../lib/api.js';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { compact } from '../lib/format.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import RewardLog from './RewardLog.jsx';

// Kontowerte im Verlauf: ein Punkt pro Sync. Jede Kennzahl hat eine eigene Skala,
// deshalb ein eigenes kleines Diagramm pro Wert (keine gemeinsame Achse).
const METRICS = [
  { key: 'platinum', label: 'Platin', icon: () => <Plat size={18} /> },
  { key: 'credits', label: 'Credits', icon: () => <Coins size={18} className="ico-credits" />, compact: true },
  { key: 'endo', label: 'Endo', icon: () => <Hexagon size={18} className="ico-endo" />, compact: true },
  { key: 'ducats', label: 'Ducats', icon: () => <Ducat size={18} /> },
  { key: 'kuva', label: 'Kuva', icon: () => <Droplet size={18} className="ico-kuva" />, compact: true },
  { key: 'relics', label: 'Relikte', icon: () => <Flame size={18} /> },
  { key: 'rivens', label: 'Rivens', icon: () => <Dices size={18} /> },
  { key: 'gear', label: 'Ausrüstung', icon: () => <Swords size={18} /> },
  { key: 'mr', label: 'Mastery-Rang', icon: () => <ChevronsUp size={18} /> },
];

const RANGES = [
  { id: '1d', label: '24 Std.', ms: 24 * 3600e3 },
  { id: '7d', label: '7 Tage', ms: 7 * 24 * 3600e3 },
  { id: '30d', label: '30 Tage', ms: 30 * 24 * 3600e3 },
  { id: 'all', label: 'Alles', ms: Infinity },
];
const VIEW_KEY = 'td.stats.view.v1';

function useLocale() {
  return useSettings().language === 'en' ? 'en-GB' : 'de-DE';
}

const fmt = (v, m, locale) => (v == null ? '–' : m.compact && Math.abs(v) >= 100000 ? compact(v) : v.toLocaleString(locale));
const fmtDelta = (d, m, locale) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d), m, locale)}`;
const fmtTime = (t, locale, withYear = false) =>
  new Date(t).toLocaleString(locale, { day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' });

/** Linie über die Zeit, mit Fadenkreuz + Tooltip beim Drüberfahren. */
function Chart({ points, metric }) {
  const locale = useLocale();
  const ref = useRef(null);
  const [width, setWidth] = useState(300);
  const [hover, setHover] = useState(null);
  const H = 120;
  const PAD = { l: 6, r: 6, t: 10, b: 18 };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = points.filter((p) => p[metric.key] != null);
  if (pts.length < 2) {
    return (
      <div className="st-chart st-empty" ref={ref}>
        {pts.length === 1 ? '…' : '–'}
      </div>
    );
  }

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vals = pts.map((p) => p[metric.key]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (t) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (width - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[metric.key]).toFixed(1)}`).join('');
  const base = H - PAD.b;
  const area = `${line}L${x(t1).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // Mauskoordinate in SVG-Einheiten (getBoundingClientRect berücksichtigt den UI-Zoom)
    const mx = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].t) - mx) < Math.abs(x(pts[best].t) - mx)) best = i;
    setHover(best);
  };

  const hp = hover != null ? pts[hover] : null;
  const prev = hover > 0 ? pts[hover - 1] : null;

  return (
    <div className="st-chart" ref={ref}>
      <svg width={width} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={metric.label}>
        <line className="st-grid" x1={PAD.l} x2={width - PAD.r} y1={y(hi)} y2={y(hi)} />
        <line className="st-grid" x1={PAD.l} x2={width - PAD.r} y1={base} y2={base} />
        <path className="st-area" d={area} />
        <path className="st-line" d={line} />
        {pts.length <= 40 && pts.map((p) => <circle key={p.t} className="st-dot" cx={x(p.t)} cy={y(p[metric.key])} r={2.5} />)}
        <text className="st-axis" x={PAD.l} y={H - 4}>
          {fmtTime(t0, locale)}
        </text>
        <text className="st-axis" x={width - PAD.r} y={H - 4} textAnchor="end">
          {fmtTime(t1, locale)}
        </text>
        {hp && (
          <g>
            <line className="st-cross" x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t - 6} y2={base} />
            <circle className="st-hover" cx={x(hp.t)} cy={y(hp[metric.key])} r={5} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="st-tip" style={{ left: `${(x(hp.t) / width) * 100}%` }}>
          <small>{fmtTime(hp.t, locale, true)}</small>
          <b>{fmt(hp[metric.key], metric, locale)}</b>
          {prev && prev[metric.key] != null && hp[metric.key] !== prev[metric.key] && (
            <small className={hp[metric.key] > prev[metric.key] ? 'up' : 'down'}>
              {fmtDelta(hp[metric.key] - prev[metric.key], metric, locale)}
            </small>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ metric, points, current }) {
  const t = useT();
  const locale = useLocale();
  const first = points.find((p) => p[metric.key] != null);
  const delta = first && current != null ? current - first[metric.key] : null;
  const Icon = metric.icon;
  return (
    <section className="st-tile">
      <header>
        <Icon />
        <span>{t(metric.label)}</span>
        {delta != null && points.length > 1 && (
          <em className={delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>{fmtDelta(delta, metric, locale)}</em>
        )}
      </header>
      <strong>{fmt(current, metric, locale)}</strong>
      <Chart points={points} metric={metric} />
    </section>
  );
}

function HistoryTable({ points }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead>
          <tr>
            <th>{t('Zeitpunkt')}</th>
            {METRICS.map((m) => (
              <th key={m.key}>{t(m.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.t}>
              <td>{fmtTime(p.t, locale, true)}</td>
              {METRICS.map((m) => (
                <td key={m.key}>{p[m.key] == null ? '–' : p[m.key].toLocaleString(locale)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountStats() {
  const t = useT();
  const { inventory, sync, syncing } = useGameData();
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(() => load(VIEW_KEY, { range: '7d', table: false }));
  const setV = (patch) => {
    const next = { ...view, ...patch };
    setView(next);
    save(VIEW_KEY, next);
  };

  // Nach jedem Sync kommt ein neuer Punkt dazu
  useEffect(() => {
    game
      .statsHistory()
      .then((h) => setHistory(h ?? []))
      .catch((e) => setError(e.message ?? String(e)));
  }, [inventory?.syncedAt]);

  const range = RANGES.find((r) => r.id === view.range) ?? RANGES[1];
  const points = useMemo(() => {
    if (!history?.length) return [];
    const from = Date.now() - range.ms;
    const inRange = history.filter((p) => p.t >= from);
    // Letzter Punkt vor dem Zeitraum als Startwert, damit die Änderung über den ganzen Zeitraum stimmt
    const before = history.filter((p) => p.t < from).pop();
    return before ? [{ ...before, t: Math.max(before.t, from) }, ...inRange] : inRange;
  }, [history, range]);

  if (error) return <p className="err">{error}</p>;
  if (!history) return <div className="empty">{t('Lade Verlauf …')}</div>;
  if (!history.length)
    return <div className="empty">{t('Noch keine Daten – synchronisiere einmal mit dem Spiel, dann beginnt der Verlauf.')}</div>;

  const latest = history[history.length - 1];

  return (
    <div className="st st-sub">
      <div className="gb-bar">
        {RANGES.map((r) => (
          <button key={r.id} className={`gb-tab ${view.range === r.id ? 'active' : ''}`} onClick={() => setV({ range: r.id })}>
            <span>{t(r.label)}</span>
          </button>
        ))}
        <div className="gb-spacer" />
        <span className="muted st-count">{t('{n} Messpunkte', { n: history.length })}</span>
        <button className={`gb-tab ${view.table ? 'active' : ''}`} onClick={() => setV({ table: !view.table })} title={t(view.table ? 'Diagramme' : 'Tabelle')}>
          {view.table ? <LineChart size={17} /> : <Table2 size={17} />}
        </button>
      </div>

      {history.length < 2 && (
        <p className="notice">
          {t('Der Verlauf startet jetzt. Jeder Sync mit dem Spiel fügt einen Messpunkt hinzu – nach ein paar Syncs siehst du hier, wie sich deine Werte entwickeln.')}{' '}
          <button className="btn" onClick={sync} disabled={syncing}>
            {t('Jetzt synchronisieren')}
          </button>
        </p>
      )}

      {view.table ? (
        <HistoryTable points={points.length ? points : history} />
      ) : (
        <div className="st-grid-tiles">
          {METRICS.map((m) => (
            <Tile key={m.key} metric={m} points={points} current={latest[m.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

// Reiter: Kontowerte (Verlauf pro Sync) und Belohnungs-Log der Spalten-Missionen
const TAB_KEY = 'td.stats.tab.v1';
export default function Stats() {
  const t = useT();
  const [tab, setTab] = useState(() => load(TAB_KEY, 'account'));
  const pick = (id) => {
    setTab(id);
    save(TAB_KEY, id);
  };
  return (
    <div className="page st">
      <div className="page-tabs">
        <button className={tab === 'account' ? 'active' : ''} onClick={() => pick('account')}>
          <LineChart size={16} /> {t('Kontowerte')}
        </button>
        <button className={tab === 'rewards' ? 'active' : ''} onClick={() => pick('rewards')}>
          <Gift size={16} /> {t('Spalten-Belohnungen')}
        </button>
      </div>
      {tab === 'rewards' ? <RewardLog /> : <AccountStats />}
    </div>
  );
}

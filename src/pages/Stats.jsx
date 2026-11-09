// Statistiken: Kontowerte im Verlauf (ein Punkt pro Sync) und Belohnungs-Log der Spalten-Missionen.
import { createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Coins, Hexagon, Flame, Dices, Swords, ChevronsUp, Table2, ChartLine, Droplet, Gift } from 'lucide-solid';
import { game, syncGame } from '../lib/game.js';
import { call, load, save } from '../lib/ipc.js';
import { settings } from '../lib/settings.js';
import { compact } from '../lib/gamedb.js';
import { t } from '../lib/i18n.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import RewardLog from './RewardLog.jsx';

// Jede Kennzahl hat eine eigene Skala, deshalb ein eigenes kleines Diagramm pro Wert.
const METRICS = [
  { key: 'platinum', label: 'Platin', icon: () => <Plat size={18} /> },
  { key: 'credits', label: 'Credits', icon: () => <Coins size={18} class="ico-credits" />, compact: true },
  { key: 'endo', label: 'Endo', icon: () => <Hexagon size={18} class="ico-endo" />, compact: true },
  { key: 'ducats', label: 'Ducats', icon: () => <Ducat size={18} /> },
  { key: 'kuva', label: 'Kuva', icon: () => <Droplet size={18} class="ico-kuva" />, compact: true },
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
const VIEW_KEY = 'cm.stats.view.v1';

const locale = () => (settings.language === 'en' ? 'en-GB' : 'de-DE');
const fmt = (v, m) => (v == null ? '–' : m.compact && Math.abs(v) >= 100000 ? compact(v) : v.toLocaleString(locale()));
const fmtDelta = (d, m) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d), m)}`;
const fmtTime = (ts, withYear = false) =>
  new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' });

/** Linie über die Zeit, mit Fadenkreuz + Tooltip beim Drüberfahren. */
function Chart(props) {
  let ref;
  const [width, setWidth] = createSignal(300);
  const [hover, setHover] = createSignal(null);
  const H = 120;
  const PAD = { l: 6, r: 6, t: 10, b: 18 };
  onMount(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, e.contentRect.width)));
    ro.observe(ref);
    onCleanup(() => ro.disconnect());
  });
  const key = props.metric.key;
  const pts = () => props.points.filter((p) => p[key] != null);
  const geo = createMemo(() => {
    const p = pts();
    if (p.length < 2) return null;
    const t0 = p[0].t;
    const t1 = p[p.length - 1].t;
    const vals = p.map((q) => q[key]);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const w = width();
    const x = (ts) => PAD.l + ((ts - t0) / Math.max(1, t1 - t0)) * (w - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = p.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q[key]).toFixed(1)}`).join('');
    const base = H - PAD.b;
    return { t0, t1, hi, x, y, line, base, area: `${line}L${x(t1).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z`, w };
  });
  const onMove = (e) => {
    const g = geo();
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * g.w;
    const p = pts();
    let best = 0;
    for (let i = 1; i < p.length; i++) if (Math.abs(g.x(p[i].t) - mx) < Math.abs(g.x(p[best].t) - mx)) best = i;
    setHover(best);
  };
  const hp = () => (hover() != null ? pts()[hover()] : null);
  const prev = () => (hover() > 0 ? pts()[hover() - 1] : null);
  return (
    <div class="st-chart" classList={{ 'st-empty': !geo() }} ref={ref}>
      <Show when={geo()} fallback={pts().length === 1 ? '…' : '–'}>
        {(g) => (
          <>
            <svg width={g().w} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={props.metric.label}>
              <line class="st-grid" x1={PAD.l} x2={g().w - PAD.r} y1={g().y(g().hi)} y2={g().y(g().hi)} />
              <line class="st-grid" x1={PAD.l} x2={g().w - PAD.r} y1={g().base} y2={g().base} />
              <path class="st-area" d={g().area} />
              <path class="st-line" d={g().line} />
              <Show when={pts().length <= 40}>
                <For each={pts()}>{(p) => <circle class="st-dot" cx={g().x(p.t)} cy={g().y(p[key])} r={2.5} />}</For>
              </Show>
              <text class="st-axis" x={PAD.l} y={H - 4}>
                {fmtTime(g().t0)}
              </text>
              <text class="st-axis" x={g().w - PAD.r} y={H - 4} text-anchor="end">
                {fmtTime(g().t1)}
              </text>
              <Show when={hp()}>
                <g>
                  <line class="st-cross" x1={g().x(hp().t)} x2={g().x(hp().t)} y1={PAD.t - 6} y2={g().base} />
                  <circle class="st-hover" cx={g().x(hp().t)} cy={g().y(hp()[key])} r={5} />
                </g>
              </Show>
            </svg>
            <Show when={hp()}>
              <div class="st-tip" style={{ left: `${(g().x(hp().t) / g().w) * 100}%` }}>
                <small>{fmtTime(hp().t, true)}</small>
                <b>{fmt(hp()[key], props.metric)}</b>
                <Show when={prev() && prev()[key] != null && hp()[key] !== prev()[key]}>
                  <small class={hp()[key] > prev()[key] ? 'up' : 'down'}>{fmtDelta(hp()[key] - prev()[key], props.metric)}</small>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function Tile(props) {
  const first = () => props.points.find((p) => p[props.metric.key] != null);
  const delta = () => (first() && props.current != null ? props.current - first()[props.metric.key] : null);
  return (
    <section class="st-tile">
      <header>
        <Dynamic component={props.metric.icon} />
        <span>{t(props.metric.label)}</span>
        <Show when={delta() != null && props.points.length > 1}>
          <em class={delta() > 0 ? 'up' : delta() < 0 ? 'down' : ''}>{fmtDelta(delta(), props.metric)}</em>
        </Show>
      </header>
      <strong>{fmt(props.current, props.metric)}</strong>
      <Chart points={props.points} metric={props.metric} />
    </section>
  );
}

function HistoryTable(props) {
  return (
    <div class="st-table-wrap">
      <table class="st-table">
        <thead>
          <tr>
            <th>{t('Zeitpunkt')}</th>
            <For each={METRICS}>{(m) => <th>{t(m.label)}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={[...props.points].reverse()}>
            {(p) => (
              <tr>
                <td>{fmtTime(p.t, true)}</td>
                <For each={METRICS}>{(m) => <td>{p[m.key] == null ? '–' : p[m.key].toLocaleString(locale())}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function AccountStats() {
  // Nach jedem Sync kommt ein neuer Punkt dazu
  const [history] = createResource(() => game.inventory?.syncedAt ?? 0, () => call('stats_history'));
  const [view, setView] = createSignal(load(VIEW_KEY, { range: '7d', table: false }));
  const setV = (patch) => {
    const next = { ...view(), ...patch };
    setView(next);
    save(VIEW_KEY, next);
  };
  const range = () => RANGES.find((r) => r.id === view().range) ?? RANGES[1];
  const points = createMemo(() => {
    const h = history() ?? [];
    if (!h.length) return [];
    const from = Date.now() - range().ms;
    const inRange = h.filter((p) => p.t >= from);
    // Letzter Punkt vor dem Zeitraum als Startwert, damit die Änderung über den ganzen Zeitraum stimmt
    const before = h.filter((p) => p.t < from).pop();
    return before ? [{ ...before, t: Math.max(before.t, from) }, ...inRange] : inRange;
  });
  const latest = () => history()[history().length - 1];
  return (
    <Switch>
      <Match when={history.error}>
        <p class="err">{String(history.error?.message ?? history.error)}</p>
      </Match>
      <Match when={!history()}>
        <div class="empty">{t('Lade Verlauf …')}</div>
      </Match>
      <Match when={!history().length}>
        <div class="empty">{t('Noch keine Daten – synchronisiere einmal mit dem Spiel, dann beginnt der Verlauf.')}</div>
      </Match>
      <Match when={true}>
        <div class="st st-sub">
          <div class="gb-bar">
            <For each={RANGES}>
              {(r) => (
                <button class="gb-tab" classList={{ active: view().range === r.id }} onClick={() => setV({ range: r.id })}>
                  <span>{t(r.label)}</span>
                </button>
              )}
            </For>
            <div class="gb-spacer" />
            <span class="muted st-count">{t('{n} Messpunkte', { n: history().length })}</span>
            <button class="gb-tab" classList={{ active: view().table }} onClick={() => setV({ table: !view().table })} title={t(view().table ? 'Diagramme' : 'Tabelle')}>
              {view().table ? <ChartLine size={17} /> : <Table2 size={17} />}
            </button>
          </div>
          <Show when={history().length < 2}>
            <p class="notice">
              {t('Der Verlauf startet jetzt. Jeder Sync mit dem Spiel fügt einen Messpunkt hinzu – nach ein paar Syncs siehst du hier, wie sich deine Werte entwickeln.')}{' '}
              <button class="btn" onClick={syncGame} disabled={game.syncing}>
                {t('Jetzt synchronisieren')}
              </button>
            </p>
          </Show>
          <Show
            when={view().table}
            fallback={
              <div class="st-grid-tiles">
                <For each={METRICS}>{(m) => <Tile metric={m} points={points()} current={latest()[m.key]} />}</For>
              </div>
            }
          >
            <HistoryTable points={points().length ? points() : history()} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

export default function Stats() {
  const [tab, setTab] = createSignal(load('cm.stats.tab.v1', 'account'));
  const pick = (id) => {
    setTab(id);
    save('cm.stats.tab.v1', id);
  };
  return (
    <div class="page st">
      <div class="page-tabs">
        <button classList={{ active: tab() === 'account' }} onClick={() => pick('account')}>
          <ChartLine size={16} /> {t('Kontowerte')}
        </button>
        <button classList={{ active: tab() === 'rewards' }} onClick={() => pick('rewards')}>
          <Gift size={16} /> {t('Spalten-Belohnungen')}
        </button>
      </div>
      <Show when={tab() === 'rewards'} fallback={<AccountStats />}>
        <RewardLog />
      </Show>
    </div>
  );
}

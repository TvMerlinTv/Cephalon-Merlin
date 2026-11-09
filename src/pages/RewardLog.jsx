// Belohnungs-Log der Spalten-Missionen (src-tauri/src/rewardlog.rs): letzte Runs + Summen pro Tag/Woche.
// Gespeichert sind nur die Namen; Platin (Sammelpreise) und Ducats kommen hier dazu.
// Ohne bekannte Wahl zählt die wertvollste Belohnung (nach Platin) als angenommene Wahl.
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import { call, on } from '../lib/ipc.js';
import { getItems } from '../lib/market.js';
import { loadBulkPrices, loadMasteryDb, loadRelicDb } from '../lib/gamedb.js';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import './rewardLog.css';

const REFINEMENT = { intact: 'Intakt', exceptional: 'Außergewöhnlich', flawless: 'Makellos', radiant: 'Strahlend' };
const PAGE = 30;
const ONE = { maximumFractionDigits: 1 };
const locale = () => (settings.language === 'en' ? 'en-GB' : 'de-DE');

function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Name -> { plat, ducats } aus Sammelpreisen, Relikt-DB, Mastery-DB und warframe.market. */
async function loadValueOf() {
  const [prices, relicDb, mastery, items] = await Promise.all([
    loadBulkPrices().catch(() => ({})),
    loadRelicDb().catch(() => ({ relics: [] })),
    loadMasteryDb().catch(() => null),
    getItems().catch(() => []),
  ]);
  const rewards = new Map();
  for (const r of relicDb.relics ?? []) for (const w of r.rewards?.intact ?? []) rewards.set(w.name, w);
  const marketDucats = new Map(items.map((i) => [i.slug, i.ducats]));
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      const w = rewards.get(name);
      const ducats = (w?.id && mastery?.index.get(w.id)?.part?.ducats) || (w?.slug && marketDucats.get(w.slug)) || 0;
      cache.set(name, { plat: prices[name.toLowerCase()] ?? null, ducats });
    }
    return cache.get(name);
  };
}

function runValue(run, valueOf) {
  const items = run.items.map((name) => ({ name, ...valueOf(name) }));
  const best = items.reduce((a, b) => ((b.plat ?? 0) > (a.plat ?? 0) || ((b.plat ?? 0) === (a.plat ?? 0) && b.ducats > a.ducats) ? b : a));
  const pick = (run.chosen && items.find((i) => i.name === run.chosen)) || best;
  return { items, pick: pick.name, assumed: !run.chosen, plat: pick.plat ?? 0, ducats: pick.ducats };
}

function Sums(props) {
  const rows = createMemo(() => {
    const groups = new Map();
    for (const r of props.runs) {
      const k = props.by === 'week' ? weekStart(r.t) : dayStart(r.t);
      const g = groups.get(k) ?? { k, runs: 0, plat: 0, ducats: 0 };
      g.runs++;
      g.plat += r.value.plat;
      g.ducats += r.value.ducats;
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => b.k - a.k).slice(0, props.by === 'week' ? 12 : 14);
  });
  const label = (k) =>
    props.by === 'week'
      ? t('Woche ab {d}', { d: new Date(k).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) })
      : new Date(k).toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <div class="st-table-wrap">
      <table class="st-table rl-sums">
        <thead>
          <tr>
            <th>{t(props.by === 'week' ? 'Woche' : 'Tag')}</th>
            <th>{t('Runs')}</th>
            <th>{t('Platin')}</th>
            <th>{t('Ducats')}</th>
            <th>{t('Ø Platin pro Run')}</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(g) => (
              <tr>
                <td>{label(g.k)}</td>
                <td>{g.runs}</td>
                <td>
                  <span class="rl-val">
                    <Plat size={13} /> {g.plat.toLocaleString(locale(), ONE)}
                  </span>
                </td>
                <td>
                  <span class="rl-val">
                    <Ducat size={13} /> {g.ducats.toLocaleString(locale())}
                  </span>
                </td>
                <td>{(g.plat / g.runs).toLocaleString(locale(), ONE)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function Run(props) {
  const v = () => props.run.value;
  return (
    <li class="rl-run">
      <div class="rl-head">
        <span class="rl-time">{new Date(props.run.t).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        <span class="muted">
          {props.run.relic?.name
            ? `${props.run.relic.name}${props.run.relic.refinement ? ` · ${t(REFINEMENT[props.run.relic.refinement] ?? props.run.relic.refinement)}` : ''}`
            : t('Relikt unbekannt')}
        </span>
        <div class="gb-spacer" />
        <button class="rl-del" onClick={() => props.onRemove(props.run)} title={t('Eintrag löschen')}>
          <Trash2 size={14} />
        </button>
      </div>
      <div class="rl-items">
        <For each={v().items}>
          {(it) => (
            <button
              class="rl-item"
              classList={{ assumed: it.name === v().pick && v().assumed, chosen: it.name === v().pick && !v().assumed }}
              onClick={() => props.onChoose(props.run, props.run.chosen === it.name ? null : it.name)}
              title={t(props.run.chosen === it.name ? 'Wahl zurücksetzen' : 'Als gewählt markieren')}
            >
              <span class="rl-name">{it.name}</span>
              <span class="rl-vals">
                <span class="rl-val">
                  <Plat size={12} /> {it.plat == null ? '–' : it.plat.toLocaleString(locale(), ONE)}
                </span>
                <span class="rl-val">
                  <Ducat size={12} /> {it.ducats || '–'}
                </span>
              </span>
              <Show when={it.name === v().pick}>
                <em>{t(v().assumed ? 'beste (angenommen)' : 'gewählt')}</em>
              </Show>
            </button>
          )}
        </For>
      </div>
    </li>
  );
}

export default function RewardLog() {
  const [valueOf] = createResource(loadValueOf);
  const [runs, { mutate, refetch }] = createResource(() => call('reward_log_list'));
  const [error, setError] = createSignal(null);
  const [by, setBy] = createSignal('day');
  const [shown, setShown] = createSignal(PAGE);
  // Neue Runs vom Overlay sofort zeigen
  onCleanup(on('reward-log', () => refetch()));

  const valued = createMemo(() => (runs() && valueOf() ? [...runs()].sort((a, b) => b.t - a.t).map((r) => ({ ...r, value: runValue(r, valueOf()) })) : null));
  const onChoose = (run, chosen) => {
    mutate((list) => list.map((r) => (r.id === run.id ? { ...r, chosen } : r)));
    call('reward_log_choose', { id: run.id, chosen }).catch((e) => setError(e.message));
  };
  const onRemove = (run) => {
    mutate((list) => list.filter((r) => r.id !== run.id));
    call('reward_log_remove', { id: run.id }).catch((e) => setError(e.message));
  };

  return (
    <Switch>
      <Match when={error() || runs.error}>
        <p class="err">{error() ?? String(runs.error?.message ?? runs.error)}</p>
      </Match>
      <Match when={!valued()}>
        <div class="empty">{t('Lade Belohnungs-Log …')}</div>
      </Match>
      <Match when={!valued().length}>
        <div class="empty">{t('Noch keine Spalten-Runs gespeichert. Nach jeder Spalten-Mission merkt sich die App hier die 4 Belohnungen vom Belohnungs-Bildschirm.')}</div>
      </Match>
      <Match when={true}>
        <div class="rl">
          <section class="rl-block">
            <div class="gb-bar">
              <h3 class="rl-title">{t('Summen')}</h3>
              <div class="gb-spacer" />
              <For each={[['day', 'Pro Tag'], ['week', 'Pro Woche']]}>
                {([id, label]) => (
                  <button class="gb-tab" classList={{ active: by() === id }} onClick={() => setBy(id)}>
                    <span>{t(label)}</span>
                  </button>
                )}
              </For>
            </div>
            <Sums runs={valued()} by={by()} />
            <p class="muted rl-hint">
              {t('Gezählt wird pro Run die gewählte Belohnung. Ist sie unbekannt, zählt die wertvollste – klicke eine Belohnung an, um deine Wahl festzulegen.')}
            </p>
          </section>
          <section class="rl-block">
            <div class="gb-bar">
              <h3 class="rl-title">{t('Letzte Runs')}</h3>
              <div class="gb-spacer" />
              <span class="muted st-count">{t('{n} Runs', { n: valued().length })}</span>
            </div>
            <ul class="rl-runs">
              <For each={valued().slice(0, shown())}>{(r) => <Run run={r} onChoose={onChoose} onRemove={onRemove} />}</For>
            </ul>
            <Show when={valued().length > shown()}>
              <button class="btn rl-more" onClick={() => setShown((n) => n + PAGE)}>
                {t('Mehr anzeigen')}
              </button>
            </Show>
          </section>
        </div>
      </Match>
    </Switch>
  );
}

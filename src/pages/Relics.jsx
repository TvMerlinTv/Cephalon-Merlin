// Relikt-Planer: eigene Relikte, erwarteter Platin-/Ducat-Wert pro Öffnung (Radshare) und was sich lohnt.
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Infinity as All, Search, ArrowDownUp, Users, Lock, Check, Sparkles } from 'lucide-solid';
import { game } from '../lib/game.js';
import { createRewardInfo } from '../lib/rewardInfo.js';
import { expectedValue, rarityOf } from '../lib/gamedb.js';
import { RelicIcon } from '../components/WorldWidgets.jsx';
import { STATUS } from '../components/ScanViews.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import { Plat, Ducat } from '../components/Icons.jsx';
import { t } from '../lib/i18n.js';
import { load, openExternal, save } from '../lib/ipc.js';

const PAGE = 40;
const TIERS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem'];
const REFINEMENTS = [
  ['intact', 'Intact'],
  ['exceptional', 'Exceptional'],
  ['flawless', 'Flawless'],
  ['radiant', 'Radiant'],
];
const SORTS = { plat: 'Platin-Profit', ducats: 'Ducats', count: 'Anzahl', name: 'Name' };
const PREFS_KEY = 'cm.relics.prefs.v1';

function RewardIcon(props) {
  const info = () => props.ri.info(props.reward.name);
  const have = () => ['have', 'owned', 'mastered'].includes(info().status);
  const tip = () =>
    [
      props.reward.name,
      t('{n} % Chance', { n: props.reward.chance }),
      info().plat != null ? t('{n} Platin', { n: info().plat }) : null,
      info().ducats ? t('{n} Ducats', { n: info().ducats }) : null,
      info().status !== 'none' && info().status !== 'forma' ? t(STATUS[info().status].text) : null,
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <button
      class={`reward ${rarityOf(props.reward.chance)}`}
      classList={{ have: have() }}
      title={tip()}
      onClick={() => props.onOpen(props.reward)}
    >
      {info().thumb ? <img src={info().thumb} alt="" loading="lazy" /> : <Sparkles size={16} />}
      <Show when={have()}>
        <span class="reward-check">
          <Check size={10} stroke-width={3} />
        </span>
      </Show>
    </button>
  );
}

export default function Relics() {
  const ri = createRewardInfo();
  const [prefs, setPrefs] = createStore({ tier: 'all', sort: 'plat', squad: 4, refinement: 'intact', onlyOwned: true, ...load(PREFS_KEY, {}) });
  const [query, setQuery] = createSignal('');
  const [limit, setLimit] = createSignal(PAGE);
  const [details, setDetails] = createSignal(null);
  const openReward = (w) => {
    const entry = w.id ? ri().mastery?.index.get(w.id) : null;
    const m = w.slug ? ri().market.get(w.slug) : null;
    if (entry) setDetails({ item: entry.item, partId: entry.part?.id });
    else if (m) setDetails({ marketItem: m });
  };
  const setPref = (k, v) => {
    setPrefs(k, v);
    save(PREFS_KEY, { ...prefs });
    setLimit(PAGE);
  };

  const rows = createMemo(() => {
    const r = ri();
    if (!r.ready) return [];
    const inv = game.inventory;
    return r.relicDb.relics.map((relic) => {
      const owned = inv?.relics?.[relic.id] ?? {};
      const total = Object.values(owned).reduce((a, b) => a + b, 0);
      const rewards = relic.rewards[prefs.refinement] ?? relic.rewards.intact ?? [];
      return {
        relic,
        owned,
        total,
        rewards,
        plat: expectedValue(rewards, (w) => r.priceOf(w.name) ?? 0, prefs.squad),
        ducats: expectedValue(rewards, (w) => r.info(w.name).ducats ?? 0, prefs.squad),
      };
    });
  });

  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    const cmp = {
      plat: (a, b) => b.plat - a.plat,
      ducats: (a, b) => b.ducats - a.ducats,
      count: (a, b) => b.total - a.total,
      name: (a, b) => a.relic.name.localeCompare(b.relic.name),
    }[prefs.sort];
    return rows()
      .filter((r) => prefs.tier === 'all' || r.relic.tier === prefs.tier)
      .filter((r) => !prefs.onlyOwned || r.total > 0)
      .filter((r) => !q || r.relic.name.toLowerCase().includes(q) || r.rewards.some((w) => w.name.toLowerCase().includes(q)))
      .sort(cmp);
  });
  const ownedTotal = () => rows().reduce((a, r) => a + r.total, 0);
  const ownedKinds = () => rows().filter((r) => r.total > 0).length;

  return (
    <Switch>
      <Match when={ri().error}>
        <div class="empty">{t('Relikt-Daten nicht ladbar: {e}', { e: ri().error })}</div>
      </Match>
      <Match when={!ri().ready}>
        <div class="empty">{t('Lade Relikte und Preise …')}</div>
      </Match>
      <Match when={true}>
        <div class="page">
          <div class="toolbar">
            <div class="filter-pills">
              <button classList={{ active: prefs.tier === 'all' }} onClick={() => setPref('tier', 'all')}>
                <All size={16} />
                <Show when={prefs.tier === 'all'}>
                  <span>{t('Alle')}</span>
                </Show>
              </button>
              <For each={TIERS}>
                {(tier) => (
                  <button classList={{ active: prefs.tier === tier }} onClick={() => setPref('tier', tier)} title={tier}>
                    <RelicIcon tier={tier} size={24} />
                    <Show when={prefs.tier === tier}>
                      <span>{tier}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div class="toolbar-right">
              <label class="search">
                <Search size={15} />
                <input
                  value={query()}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setLimit(PAGE);
                  }}
                  placeholder={t('Relikt oder Teil')}
                />
              </label>
              <label class="select">
                <ArrowDownUp size={15} />
                <select value={prefs.sort} onChange={(e) => setPref('sort', e.currentTarget.value)}>
                  <For each={Object.entries(SORTS)}>{([id, label]) => <option value={id}>{t(label)}</option>}</For>
                </select>
              </label>
              <label class="select">
                <select value={prefs.refinement} onChange={(e) => setPref('refinement', e.currentTarget.value)} title={t('Veredelung für die Berechnung')}>
                  <For each={REFINEMENTS}>{([id, label]) => <option value={id}>{label}</option>}</For>
                </select>
              </label>
              <label class="select" title={t('Squad-Größe (Radshare)')}>
                <Users size={15} />
                <select value={prefs.squad} onChange={(e) => setPref('squad', Number(e.currentTarget.value))}>
                  <For each={[1, 2, 3, 4]}>{(n) => <option value={n}>{n}</option>}</For>
                </select>
              </label>
            </div>
          </div>

          <div class="card-grid relic-grid">
            <For each={shown().slice(0, limit())}>
              {(row) => (
                <article class="relic-card">
                  <div class="relic-img">
                    <Show when={row.relic.image}>
                      <img src={row.relic.image} alt="" loading="lazy" />
                    </Show>
                    <span class="relic-count">
                      <Show when={row.relic.vaulted}>
                        <Lock size={11} />
                      </Show>{' '}
                      x{row.total}
                    </span>
                  </div>
                  <div class="relic-info">
                    <h3>{row.relic.name}</h3>
                    <div class="relic-owned">
                      <For each={REFINEMENTS.filter(([id]) => row.owned[id])}>
                        {([id, label]) => (
                          <span>
                            {row.owned[id]}x {label}
                          </span>
                        )}
                      </For>
                      <Show when={row.total === 0}>
                        <span class="muted">{t('nicht im Besitz')}</span>
                      </Show>
                    </div>
                    <div class="relic-values">
                      <span title={t('Erwarteter Platin-Wert pro Öffnung')}>
                        <Plat /> {row.plat.toFixed(1)}
                      </span>
                      <span title={t('Erwartete Ducats pro Öffnung')}>
                        <Ducat /> {row.ducats.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div class="rewards">
                    <For each={row.rewards}>{(w) => <RewardIcon reward={w} ri={ri()} onOpen={openReward} />}</For>
                  </div>
                </article>
              )}
            </For>
          </div>
          <Show when={shown().length > limit()}>
            <button class="btn more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('Mehr anzeigen ({n} weitere)', { n: shown().length - limit() })}
            </button>
          </Show>
          <Show when={shown().length === 0}>
            <div class="empty">{t('Keine Relikte in dieser Ansicht.')}</div>
          </Show>

          <div class="totals">
            <label class="check">
              <input type="checkbox" checked={prefs.onlyOwned} onChange={(e) => setPref('onlyOwned', e.currentTarget.checked)} /> {t('Nur eigene')}
            </label>
            <span title={t('Verschiedene Relikte / Relikte insgesamt')}>{t('{a} Sorten · {b} Stück', { a: ownedKinds(), b: ownedTotal() })}</span>
          </div>
          <Show when={details()}>
            <ItemDetails item={details().item} partId={details().partId} marketItem={details().marketItem} onClose={() => setDetails(null)} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

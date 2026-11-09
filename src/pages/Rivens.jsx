// Rivens: alle eigenen Rivens mit Werten bei Rang 8, Würfelglück, Kuva-Kosten und Marktpreisen.
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { Dices, Lock, RefreshCw, ExternalLink, X } from 'lucide-solid';
import HoverSearch from '../components/HoverSearch.jsx';
import { game } from '../lib/game.js';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { call, load, save, openExternal } from '../lib/ipc.js';
import { Plat } from '../components/Icons.jsx';
import { RIVEN_TYPES, RAW_LABELS, loadRivenMeta, describeRiven, challengeText, nextRollKuva, spentKuva, parseMarketError } from '../lib/rivens.js';

const SORTS = [
  { id: 'weapon', label: 'Waffe' },
  { id: 'disposition', label: 'Disposition' },
  { id: 'quality', label: 'Würfelglück' },
  { id: 'rerolls', label: 'Umgewürfelt' },
];
const VIEW_KEY = 'cm.rivens.view.v1';

function Dots(props) {
  return (
    <span class="rv-dots" aria-label={`${props.n}/5`}>
      <For each={[1, 2, 3, 4, 5]}>{(i) => <i classList={{ on: i <= props.n }} />}</For>
    </span>
  );
}

function StatLine(props) {
  const s = props.s;
  const pct = Math.round(s.roll * 100);
  const cls = s.roll >= 0.75 ? 'hi' : s.roll >= 0.35 ? 'mid' : 'lo';
  return (
    <li class={s.curse ? 'curse' : 'buff'}>
      <b>{s.text}</b>
      <span>{s.label}</span>
      <span class={`rv-roll ${cls}`} title={`${pct}%`}>
        <i style={{ width: `${Math.max(4, pct)}%` }} />
      </span>
    </li>
  );
}

function RivenCard(props) {
  const r = () => props.r;
  return (
    <button class="rv-card" classList={{ active: props.active }} onClick={() => props.onPick(r())}>
      <div class="rv-head">
        {r().thumb ? <img src={r().thumb} alt="" loading="lazy" /> : <Dices size={22} />}
        <div>
          <strong>{r().weapon ?? t('Unbekannt')}</strong>
          <small>{t(r().typeLabel)}</small>
        </div>
        <Dots n={r().dots} />
      </div>
      <ul class="rv-stats">
        <For each={r().stats}>{(s) => <StatLine s={s} />}</For>
      </ul>
      <div class="rv-foot">
        <span title={t('Mastery-Rang')}>MR {r().mr ?? '–'}</span>
        <span title={t('Rang')}>
          {t('Rang')} {r().rank}/8
        </span>
        <Show when={r().polarityName}>
          <span>{r().polarityName}</span>
        </Show>
        <span title={t('So oft umgewürfelt')}>
          <RefreshCw size={12} /> {r().rerolls}
        </span>
      </div>
    </button>
  );
}

function Prices(props) {
  const positive = () => props.r.stats.filter((s) => !s.curse && s.slug).map((s) => s.slug);
  const [same, setSame] = createSignal(null);
  const [all, setAll] = createSignal(null);
  const [error, setError] = createSignal(null);
  const [attempt, setAttempt] = createSignal(0);
  const [slow, setSlow] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  createEffect(
    on([() => props.r.id, attempt], () => {
      if (!props.r.slug) return;
      let alive = true;
      setSame(null);
      setAll(null);
      setError(null);
      setSlow(false);
      const slowTimer = setTimeout(() => setSlow(true), 2500);
      const fail = (e) => {
        const err = parseMarketError(e);
        if (alive && !err.aborted) setError(err);
      };
      call('riven_auctions', { weapon: props.r.slug, positive: [] })
        .then((a) => alive && setAll(a))
        .catch(fail);
      if (positive().length)
        call('riven_auctions', { weapon: props.r.slug, positive: positive() })
          .then((a) => alive && setSame(a))
          .catch(fail);
      onCleanup(() => {
        alive = false;
        clearTimeout(slowTimer);
        // Weggeklickt: noch wartende Anfragen gehen gar nicht erst raus (schont das Limit)
        call('riven_auctions_cancel').catch(() => {});
      });
    }),
  );

  // Ausgelastet: Countdown und danach von selbst neu versuchen
  createEffect(() => {
    const e = error();
    if (!e?.retryAt) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= e.retryAt) setAttempt((n) => n + 1);
    }, 1000);
    onCleanup(() => clearInterval(tick));
  });

  const row = (title, list) => (
    <div class="rv-price">
      <span>{title}</span>
      <Switch fallback={<span class="muted">…</span>}>
        <Match when={list()?.length === 0}>
          <span class="muted">{t('keine Angebote')}</span>
        </Match>
        <Match when={list()?.length > 0}>
          <span>
            <b>
              <Plat size={14} /> {list()[0].price}
            </b>
            <small>
              {' '}
              · {t('Median')} {list()[Math.floor(Math.min(list().length, 10) / 2)].price} · {t('{n} Angebote', { n: list().length })}
            </small>
          </span>
        </Match>
      </Switch>
    </div>
  );

  return (
    <Show when={props.r.slug} fallback={<p class="muted">{t('Diese Waffe gibt es auf warframe.market nicht.')}</p>}>
      <Show
        when={!error()}
        fallback={
          <div class="rv-price-error">
            <p class={error().busy ? 'muted' : 'err'}>
              {error().busy
                ? error().retryAt && error().retryAt > now()
                  ? t('warframe.market ist gerade ausgelastet – neuer Versuch in {n} s.', { n: Math.ceil((error().retryAt - now()) / 1000) })
                  : t('warframe.market ist gerade ausgelastet – bitte gleich nochmal versuchen.')
                : `${t('Preise konnten nicht geladen werden.')} (${error().message})`}
            </p>
            <button class="btn" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw size={14} /> {t('Erneut versuchen')}
            </button>
          </div>
        }
      >
        <Show when={positive().length > 0}>{row(t('Gleiche positive Stats'), same)}</Show>
        {row(t('Alle Rivens dieser Waffe'), all)}
        <Show when={slow() && all() == null}>
          <p class="muted small">{t('In der Warteschlange – warframe.market erlaubt nur wenige Riven-Abfragen pro Minute.')}</p>
        </Show>
        <Show when={same()?.length > 0}>
          <ul class="rv-offers">
            <For each={same().slice(0, 5)}>
              {(a) => (
                <li>
                  <span class={`rv-status ${a.status}`} title={a.status} />
                  <span class="rv-offer-name">{a.name}</span>
                  <small>
                    <RefreshCw size={11} /> {a.rerolls}
                  </small>
                  <b>
                    <Plat size={13} /> {a.price}
                  </b>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <button class="btn" onClick={() => openExternal(`https://warframe.market/auctions/search?type=riven&weapon_url_name=${props.r.slug}&sort_by=price_asc`)}>
          <ExternalLink size={14} /> {t('Auf warframe.market ansehen')}
        </button>
      </Show>
    </Show>
  );
}

function Detail(props) {
  const r = () => props.r;
  return (
    <aside class="rv-detail">
      <button class="rv-close" onClick={props.onClose} title={t('Schließen')}>
        <X size={16} />
      </button>
      <div class="rv-head big">
        {r().thumb ? <img src={r().thumb} alt="" /> : <Dices size={30} />}
        <div>
          <strong>{r().weapon ?? t('Unbekannt')}</strong>
          <small>
            {t(r().typeLabel)} · {t('Disposition')} {r().disposition?.toFixed(2) ?? '?'}
          </small>
        </div>
        <Dots n={r().dots} />
      </div>
      <p class="muted rv-note">{t('Werte bei Rang 8 (maximal)')}</p>
      <ul class="rv-stats big">
        <For each={r().stats}>{(s) => <StatLine s={s} />}</For>
      </ul>
      <dl class="rv-facts">
        <dt>{t('Würfelglück')}</dt>
        <dd>{r().quality == null ? '–' : `${Math.round(r().quality * 100)}%`}</dd>
        <dt>MR</dt>
        <dd>{r().mr ?? '–'}</dd>
        <dt>{t('Rang')}</dt>
        <dd>{r().rank}/8</dd>
        <dt>{t('Polarität')}</dt>
        <dd>{r().polarityName ?? '–'}</dd>
        <dt>{t('Umgewürfelt')}</dt>
        <dd>
          {r().rerolls}× · {spentKuva(r().rerolls).toLocaleString('de-DE')} Kuva
        </dd>
        <dt>{t('Nächster Wurf')}</dt>
        <dd>{nextRollKuva(r().rerolls).toLocaleString('de-DE')} Kuva</dd>
      </dl>
      <h4>{t('Marktpreis')}</h4>
      <Prices r={r()} />
    </aside>
  );
}

export default function Rivens() {
  const [meta] = createResource(() => settings.language, loadRivenMeta);
  const [view, setView] = createSignal(load(VIEW_KEY, { type: 'all', sort: 'weapon' }));
  const [query, setQuery] = createSignal('');
  const [picked, setPicked] = createSignal(null);
  const setV = (patch) => {
    const next = { ...view(), ...patch };
    setView(next);
    save(VIEW_KEY, next);
  };
  const data = () => game.inventory?.rivens;
  const all = createMemo(() => (data()?.list ?? []).map((r) => describeRiven(r, meta.error ? null : meta())));
  const unveiled = () => all().filter((r) => !r.challenge);
  const veiled = () => all().filter((r) => r.challenge);
  const rawTotal = () => Object.values(data()?.raw ?? {}).reduce((a, b) => a + b, 0);
  const list = createMemo(() => {
    const q = query().trim().toLowerCase();
    const sorters = {
      weapon: (a, b) => (a.weapon ?? '').localeCompare(b.weapon ?? ''),
      disposition: (a, b) => (b.disposition ?? 0) - (a.disposition ?? 0),
      quality: (a, b) => (b.quality ?? 0) - (a.quality ?? 0),
      rerolls: (a, b) => b.rerolls - a.rerolls,
    };
    return unveiled()
      .filter((r) => view().type === 'all' || r.type === view().type)
      .filter((r) => !q || (r.weapon ?? '').toLowerCase().includes(q) || r.stats.some((s) => s.label.toLowerCase().includes(q)))
      .sort(sorters[view().sort] ?? sorters.weapon);
  });
  const current = () => (picked() ? all().find((r) => r.id === picked()) : null);
  const typesPresent = () => new Set(unveiled().map((r) => r.type));

  return (
    <Switch>
      <Match when={!game.inventory}>
        <div class="empty">{t('Synchronisiere zuerst dein Inventar, um deine Rivens zu sehen.')}</div>
      </Match>
      <Match when={!data()}>
        <div class="empty">{t('Bitte einmal neu synchronisieren – die Riven-Daten fehlen noch.')}</div>
      </Match>
      <Match when={true}>
        <div class="page rv" classList={{ 'with-detail': !!current() }}>
          <div class="rv-main">
            <div class="rv-summary">
              <span>
                <b>{unveiled().length}</b> {t('enthüllt')}
              </span>
              <span>
                <b>{veiled().length}</b> {t('verschleiert')}
              </span>
              <span title={Object.entries(data().raw).map(([k, n]) => `${t(RAW_LABELS[k] ?? k)}: ${n}`).join('\n')}>
                <b>{rawTotal()}</b> {t('ungeöffnet')}
              </span>
              <Show when={data().slots > 0}>
                <span>
                  <b>
                    {all().length}/{data().slots}
                  </b>{' '}
                  {t('Plätze')}
                </span>
              </Show>
            </div>
            <div class="gb-bar">
              <button class="gb-tab" classList={{ active: view().type === 'all' }} onClick={() => setV({ type: 'all' })}>
                <span>{t('Alle')}</span>
              </button>
              <For each={RIVEN_TYPES.filter((x) => typesPresent().has(x.id))}>
                {(x) => (
                  <button class="gb-tab" classList={{ active: view().type === x.id }} onClick={() => setV({ type: x.id })}>
                    <span>{t(x.label)}</span>
                  </button>
                )}
              </For>
              <div class="gb-spacer" />
              <select class="rv-sort" value={view().sort} onChange={(e) => setV({ sort: e.currentTarget.value })} title={t('Sortieren')}>
                <For each={SORTS}>{(s) => <option value={s.id}>{t(s.label)}</option>}</For>
              </select>
              <HoverSearch value={query()} onChange={setQuery} />
            </div>
            <Show when={meta.error}>
              <p class="err">{t('warframe.market nicht erreichbar – Werte ohne Disposition.')}</p>
            </Show>
            <Show when={list().length === 0}>
              <div class="empty">{t('Nichts gefunden.')}</div>
            </Show>
            <div class="rv-grid">
              <For each={list()}>{(r) => <RivenCard r={r} active={r.id === picked()} onPick={(x) => setPicked(x.id === picked() ? null : x.id)} />}</For>
            </div>
            <Show when={veiled().length > 0}>
              <h3 class="rv-section">
                <Lock size={16} /> {t('Verschleierte Rivens')}
              </h3>
              <ul class="rv-veiled">
                <For each={veiled()}>
                  {(r) => (
                    <li>
                      <span class="rv-veiled-type">{t(r.typeLabel)}</span>
                      <span class="rv-veiled-text">{challengeText(r.challenge)}</span>
                      <span class="rv-veiled-prog">
                        <i style={{ width: `${Math.min(100, (r.challenge.progress / r.challenge.required) * 100)}%` }} />
                        <small>
                          {r.challenge.progress}/{r.challenge.required}
                        </small>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <Show when={current()} keyed>
            {(r) => <Detail r={r} onClose={() => setPicked(null)} />}
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

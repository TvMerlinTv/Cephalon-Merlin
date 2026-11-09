// Builds von overframe.gg: suchen, Mods und Guide ansehen, Favoriten merken, Builds mit Checkliste verfolgen.
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import {
  Search, X, ThumbsUp, User, Clock, ExternalLink, LoaderCircle, RefreshCw, History, Backpack, MessageSquare, ArrowDownUp, WifiOff,
  ShieldAlert, Wrench, Star, Target, CircleCheck, Trash2,
} from 'lucide-solid';
import { openExternal, load, save } from '../lib/ipc.js';
import { loadMasteryDb, compact } from '../lib/gamedb.js';
import { game } from '../lib/game.js';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { Plat } from '../components/Icons.jsx';
import Markdown from '../components/Markdown.jsx';
import BuildMods, { loadData } from '../components/BuildMods.jsx';
import BuildChecklist, { buildProgress } from '../components/BuildChecklist.jsx';
import { saved, toggleFavorite, toggleActive, removeDone, snapshot } from '../lib/savedBuilds.js';
import { OVERFRAME, getBuilds, getBuild, buildsErrorKind, loadRecent, pushRecent, loadSelectedItem, saveSelectedItem } from '../lib/builds.js';
import './builds.css';

const GEAR_CATEGORIES = ['Warframes', 'Primär', 'Sekundär', 'Nahkampf', 'Begleiter', 'Begleiter-Waffen', 'Archwing', 'Arch-Gun', 'Arch-Melee'];
const ERROR_TEXT = {
  offline: 'Keine Verbindung zu overframe.gg – bist du online?',
  blocked: 'overframe.gg blockiert die Anfrage gerade (Cloudflare-Schutz). Versuch es später noch einmal oder öffne die Seite im Browser.',
  busy: 'overframe.gg ist gerade ausgelastet. Versuch es gleich noch einmal.',
  missing: 'Build nicht gefunden – vielleicht wurde er gelöscht.',
  other: 'Builds konnten nicht geladen werden.',
};

function relTime(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(settings.language === 'de' ? 'de' : 'en', { numeric: 'auto' });
  for (const [unit, sec] of [['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  return rtf.format(0, 'minute');
}
const fullDate = (iso) => new Date(iso).toLocaleDateString(settings.language === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' });
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const itemFromUrl = (url, items) => {
  const slug = url?.split('/')[3];
  return slug ? items.find((i) => slugOf(i.name) === slug) ?? null : null;
};

function ItemIcon(props) {
  const [broken, setBroken] = createSignal(false);
  const size = () => props.size ?? 28;
  return (
    <Show when={props.src && !broken()} fallback={<span class="bld-ico-empty" style={{ width: `${size()}px`, height: `${size()}px` }} />}>
      <img src={props.src} alt="" width={size()} height={size()} loading="lazy" onError={() => setBroken(true)} />
    </Show>
  );
}

function ErrorBox(props) {
  const kind = buildsErrorKind(props.error);
  return (
    <div class="empty bld-error">
      {kind === 'offline' ? <WifiOff size={30} /> : <ShieldAlert size={30} />}
      <p>{t(ERROR_TEXT[kind])}</p>
      <Show when={kind === 'other'}>
        <p class="small">{props.error?.message}</p>
      </Show>
      <div class="empty-actions">
        <button class="btn" onClick={props.onRetry}>
          <RefreshCw size={15} /> {t('Erneut versuchen')}
        </button>
        <Show when={props.overframeUrl}>
          <button class="btn" onClick={() => openExternal(props.overframeUrl)}>
            <ExternalLink size={15} /> {t('Auf Overframe öffnen')}
          </button>
        </Show>
      </div>
    </div>
  );
}

// ---------- Suche mit Autovervollständigung ----------
function ItemSearch(props) {
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let box;
  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return [];
    const starts = [];
    const contains = [];
    for (const it of props.items) {
      const n = it.name.toLowerCase();
      if (n.startsWith(q)) starts.push(it);
      else if (n.includes(q)) contains.push(it);
    }
    return [...starts, ...contains].slice(0, 12);
  });
  const close = (e) => !box?.contains(e.target) && setOpen(false);
  onMount(() => document.addEventListener('mousedown', close));
  onCleanup(() => document.removeEventListener('mousedown', close));
  const pick = (name) => {
    props.onPick(name);
    setQuery('');
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      const it = matches()[active()];
      if (it) pick(it.name);
      else if (query().trim()) pick(query().trim());
    } else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div class="bld-search" ref={box}>
      <label class="search big">
        <Search size={16} />
        <input
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={t('Item suchen, z. B. Revenant Prime, Glaive, Laetum …')}
        />
        <Show when={query()}>
          <button class="icon-btn" onClick={() => setQuery('')} title={t('Leeren')}>
            <X size={14} />
          </button>
        </Show>
      </label>
      <Show when={open() && matches().length > 0}>
        <ul class="bld-suggest">
          <For each={matches()}>
            {(it, i) => (
              <li>
                <button classList={{ active: i() === active() }} onMouseEnter={() => setActive(i())} onClick={() => pick(it.name)}>
                  <ItemIcon src={it.image} size={30} />
                  <span>{it.name}</span>
                  <small class="muted">{t(it.category)}</small>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function MyGear(props) {
  const [cat, setCat] = createSignal('all');
  const cats = () => GEAR_CATEGORIES.filter((c) => props.gear.some((g) => g.category === c));
  const list = () => (cat() === 'all' ? props.gear : props.gear.filter((g) => g.category === cat()));
  return (
    <section class="bld-gear">
      <div class="bld-gear-head">
        <h3>
          <Backpack size={17} /> {t('Meine Ausrüstung')}
        </h3>
        <div class="filter-pills">
          <button classList={{ active: cat() === 'all' }} onClick={() => setCat('all')}>
            {t('Alle')} <small>{props.gear.length}</small>
          </button>
          <For each={cats()}>
            {(c) => (
              <button classList={{ active: cat() === c }} onClick={() => setCat(c)}>
                {t(c)}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="bld-gear-grid">
        <For each={list()}>
          {(g) => (
            <button onClick={() => props.onPick(g.name)} title={g.name}>
              <ItemIcon src={g.image} size={48} />
              <span>{g.name}</span>
            </button>
          )}
        </For>
      </div>
    </section>
  );
}

// ---------- Build-Liste und Details ----------
function BuildList(props) {
  const [retry, setRetry] = createSignal(0);
  const [builds] = createResource(() => [props.itemName, retry()], ([name]) => getBuilds(name));
  const sorted = createMemo(() => {
    const list = [...(builds() ?? [])];
    if (props.sort === 'date') list.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    else list.sort((a, b) => b.score - a.score);
    return list;
  });
  // Ersten Build gleich öffnen, damit rechts nicht leer bleibt
  createEffect(on(sorted, (list) => list.length && !list.some((b) => b.id === props.selectedId) && props.onSelect(list[0].id)));
  return (
    <Switch>
      <Match when={builds.loading}>
        <div class="empty">
          <LoaderCircle size={22} class="spin" />
          <p>{t('Lade Builds von overframe.gg …')}</p>
        </div>
      </Match>
      <Match when={builds.error}>
        <ErrorBox error={builds.error} onRetry={() => setRetry((r) => r + 1)} overframeUrl={OVERFRAME} />
      </Match>
      <Match when={!sorted().length}>
        <div class="empty">
          <Wrench size={28} />
          <p>{t('Für {name} gibt es auf Overframe noch keine Builds.', { name: props.itemName })}</p>
          <p class="small">{t('Prüfe die Schreibweise – gesucht wird mit dem englischen Item-Namen.')}</p>
        </div>
      </Match>
      <Match when={true}>
        <ul class="bld-list">
          <For each={sorted()}>
            {(b) => (
              <li>
                <button classList={{ active: b.id === props.selectedId }} onClick={() => props.onSelect(b.id)}>
                  <span class="bld-score" title={t('Stimmen')}>
                    <ThumbsUp size={13} />
                    {compact(b.score)}
                  </span>
                  <span class="bld-card-main">
                    <b class="bld-card-title">{b.title || t('(ohne Titel)')}</b>
                    <span class="bld-card-meta">
                      <span>
                        <User size={12} /> {b.author?.username ?? '–'}
                      </span>
                      <span title={t('Forma')}>
                        <span class="bld-forma" /> {b.formas}
                      </span>
                      <span title={fullDate(b.updated)}>
                        <Clock size={12} /> {relTime(b.updated)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Match>
    </Switch>
  );
}

function BuildDetail(props) {
  const [retry, setRetry] = createSignal(0);
  const [build] = createResource(() => [props.id, retry()], ([id]) => getBuild(id));
  let scroll;
  createEffect(on(() => props.id, () => scroll?.scrollTo({ top: 0 })));
  const url = () => (build() ? OVERFRAME + build().url : `${OVERFRAME}/build/${props.id}/`);
  const item = () => (build() ? itemFromUrl(build().url, props.items) : null);
  const snap = () => (build() ? snapshot(build(), item()?.name) : null);
  const fav = () => saved.fav.includes(props.id);
  const active = () => saved.active.includes(props.id);
  const done = () => saved.done.includes(props.id);
  return (
    <div class="bld-detail" ref={scroll}>
      <Switch>
        <Match when={build.loading}>
          <div class="empty">
            <LoaderCircle size={22} class="spin" />
          </div>
        </Match>
        <Match when={build.error}>
          <ErrorBox error={build.error} onRetry={() => setRetry((r) => r + 1)} overframeUrl={url()} />
        </Match>
        <Match when={build()}>
          {(b) => (
            <>
              <div class="bld-detail-head">
                <div>
                  <h2>{b().title || t('(ohne Titel)')}</h2>
                  <p class="muted">
                    {t('von {name}', { name: b().author?.username ?? '–' })} · {t('aktualisiert {when}', { when: relTime(b().updated) })} ({fullDate(b().updated)})
                  </p>
                </div>
                <div class="bld-detail-actions">
                  <button class="btn" classList={{ 'bld-fav-on': fav() }} onClick={() => toggleFavorite(snap())} title={t('Zu den Favoriten')}>
                    <Star size={15} fill={fav() ? 'currentColor' : 'none'} /> {t(fav() ? 'Favorit' : 'Favorisieren')}
                  </button>
                  <button class="btn" classList={{ 'bld-active-on': active() }} onClick={() => toggleActive(snap())} title={t('In die Liste „In Arbeit“ – mit Checkliste zum Fertigstellen')}>
                    {done() ? <CircleCheck size={15} /> : <Target size={15} />} {t(active() ? 'Wird verfolgt' : done() ? 'Fertig – neu verfolgen' : 'Verfolgen')}
                  </button>
                  <button class="btn btn-primary" onClick={() => openExternal(url())}>
                    <ExternalLink size={15} /> {t('Auf Overframe öffnen')}
                  </button>
                </div>
              </div>
              <div class="bld-facts">
                <span title={t('Stimmen')}>
                  <ThumbsUp size={14} /> {b().score.toLocaleString(settings.language === 'de' ? 'de-DE' : 'en-US')}
                </span>
                <span title={t('Forma')}>
                  <span class="bld-forma" /> {b().formas} Forma
                </span>
                <Show when={b().mastery_rank > 0}>
                  <span title={t('Mastery-Rang')}>MR {b().mastery_rank}</span>
                </Show>
                <Show when={b().endo_cost > 0}>
                  <span title={t('Endo für alle Mods')}>{compact(b().endo_cost)} Endo</span>
                </Show>
                <Show when={b().platinum_cost > 0}>
                  <span title={t('Ungefährer Platin-Preis der Mods')}>
                    <Plat size={14} /> {b().platinum_cost}
                  </span>
                </Show>
                <Show when={b().comment_count != null}>
                  <span title={t('Kommentare')}>
                    <MessageSquare size={14} /> {b().comment_count}
                  </span>
                </Show>
              </div>
              <Show when={active()}>
                <BuildChecklist snap={snap()} item={item()} />
              </Show>
              <BuildMods slots={b().slots} />
              <Show when={b().description?.trim()} fallback={<p class="muted">{t('Dieser Build hat keinen Guide-Text.')}</p>}>
                <Markdown text={b().description} onOpenBuild={props.onOpenBuild} />
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}

function SavedList(props) {
  const [data] = createResource(() => loadData().catch(() => ({ mods: {}, market: new Map() })));
  const ids = () => (props.tab === 'fav' ? saved.fav : saved.active);
  const Row = (rp) => {
    const b = () => saved.builds[rp.id];
    const item = () => (b() ? props.items.find((i) => i.name === b().item) ?? itemFromUrl(b().url, props.items) : null);
    const p = () => (!rp.isDone && props.tab === 'active' && data() && b() ? buildProgress(b(), data(), game.inventory, saved.checks[rp.id], item()) : null);
    return (
      <Show when={b()}>
        <li>
          <button classList={{ active: rp.id === props.selectedId, 'bld-done': rp.isDone }} onClick={() => props.onSelect(rp.id)}>
            <ItemIcon src={item()?.image} size={40} />
            <span class="bld-card-main">
              <b class="bld-card-title">{b().title || t('(ohne Titel)')}</b>
              <span class="bld-card-meta">
                <span>{b().item ?? '–'}</span>
                <span>
                  <User size={12} /> {b().author ?? '–'}
                </span>
                <Show when={!p()}>
                  <span title={fullDate(b().updated)}>
                    <Clock size={12} /> {relTime(b().updated)}
                  </span>
                </Show>
              </span>
              <Show when={p()}>
                <span class="bld-progress" title={t('{a} von {b} erledigt', { a: p().done, b: p().total })}>
                  <span class="bc-bar">
                    <i style={{ width: `${p().total ? (p().done / p().total) * 100 : 0}%` }} />
                  </span>
                  <small>
                    {p().done}/{p().total}
                  </small>
                </span>
              </Show>
            </span>
            <Show when={rp.isDone}>
              <span
                class="icon-btn"
                role="button"
                title={t('Aus der Liste entfernen')}
                onClick={(e) => {
                  e.stopPropagation();
                  removeDone(rp.id);
                }}
              >
                <Trash2 size={14} />
              </span>
            </Show>
          </button>
        </li>
      </Show>
    );
  };
  return (
    <Show
      when={ids().length || (props.tab === 'active' && saved.done.length)}
      fallback={
        <div class="empty">
          {props.tab === 'fav' ? <Star size={26} /> : <Target size={26} />}
          <p>
            {t(
              props.tab === 'fav'
                ? 'Noch keine Favoriten. Öffne einen Build und klick auf „Favorisieren“.'
                : 'Noch nichts in Arbeit. Öffne einen Build und klick auf „Verfolgen“ – dann bekommst du eine Checkliste mit allem, was noch fehlt.',
            )}
          </p>
        </div>
      }
    >
      <ul class="bld-list">
        <For each={ids()}>{(id) => <Row id={id} isDone={false} />}</For>
        <Show when={props.tab === 'active' && saved.done.length > 0}>
          <li class="bld-list-sep muted small">
            <CircleCheck size={13} /> {t('Fertig')} ({saved.done.length})
          </li>
          <For each={saved.done}>{(id) => <Row id={id} isDone={true} />}</For>
        </Show>
      </ul>
    </Show>
  );
}

export default function Builds() {
  const [db] = createResource(() => loadMasteryDb());
  const [item, setItem] = createSignal(loadSelectedItem());
  const [recent, setRecent] = createSignal(loadRecent());
  const [sort, setSort] = createSignal('score');
  const [buildId, setBuildId] = createSignal(null);
  const [showGear, setShowGear] = createSignal(false);
  const [tab, setTab] = createSignal(load('cm.builds.tab', 'search'));
  const [savedId, setSavedId] = createSignal(null);
  const pickTab = (x) => {
    setTab(x);
    save('cm.builds.tab', x);
  };
  const items = createMemo(() => (db()?.items ?? []).filter((i) => GEAR_CATEGORIES.includes(i.category)));
  const byName = createMemo(() => new Map(items().map((i) => [i.name.toLowerCase(), i])));
  // Eigene Ausrüstung, meistbenutzte (meiste XP) zuerst
  const gear = createMemo(() => {
    const inv = game.inventory;
    if (!inv) return [];
    return items()
      .filter((i) => (inv.owned[i.id] ?? 0) > 0)
      .sort((a, b) => (inv.xp[b.id] ?? 0) - (inv.xp[a.id] ?? 0));
  });
  const pick = (name) => {
    const canonical = byName().get(name.toLowerCase())?.name ?? name;
    setItem(canonical);
    saveSelectedItem(canonical);
    if (byName().has(canonical.toLowerCase())) setRecent(pushRecent(canonical)); // Tippfehler nicht merken
    setBuildId(null);
    setShowGear(false);
    pickTab('search');
  };
  // Von anderen Seiten (Item-Details) vorgewählt, während die Seite schon offen ist
  const onPending = () => {
    const name = loadSelectedItem();
    if (name) pick(name);
  };
  window.addEventListener('cm:builds-item', onPending);
  onCleanup(() => window.removeEventListener('cm:builds-item', onPending));
  createEffect(on(db, (d) => d && item() && byName().has(item().toLowerCase()) && setRecent(pushRecent(byName().get(item().toLowerCase()).name)), { defer: true }));
  const current = () => (item() ? byName().get(item().toLowerCase()) : null);

  return (
    <div class="page bld">
      <div class="page-tabs bld-tabs">
        <button classList={{ active: tab() === 'search' }} onClick={() => pickTab('search')}>
          <Search size={15} /> {t('Suche')}
        </button>
        <button classList={{ active: tab() === 'fav' }} onClick={() => pickTab('fav')}>
          <Star size={15} /> {t('Favoriten')}{' '}
          <Show when={saved.fav.length > 0}>
            <span class="count">{saved.fav.length}</span>
          </Show>
        </button>
        <button classList={{ active: tab() === 'active' }} onClick={() => pickTab('active')}>
          <Target size={15} /> {t('In Arbeit')}{' '}
          <Show when={saved.active.length > 0}>
            <span class="count">{saved.active.length}</span>
          </Show>
        </button>
      </div>
      <Show
        when={tab() === 'search'}
        fallback={
          <div class="bld-cols">
            <aside class="bld-side">
              <SavedList tab={tab()} selectedId={savedId()} onSelect={setSavedId} items={items()} />
            </aside>
            <Show when={savedId()} keyed fallback={<div class="bld-detail" />}>
              {(id) => <BuildDetail id={id} onOpenBuild={setSavedId} items={items()} />}
            </Show>
          </div>
        }
      >
        <div class="toolbar bld-toolbar">
          <ItemSearch items={items()} onPick={pick} />
          <Show when={gear().length > 0 && item()}>
            <button class="btn" classList={{ 'btn-primary': showGear() }} onClick={() => setShowGear((s) => !s)}>
              <Backpack size={15} /> {t('Meine Ausrüstung')}
            </button>
          </Show>
          <div class="toolbar-right">
            <button class="bld-source muted small" onClick={() => openExternal(OVERFRAME)} title="overframe.gg">
              {t('Daten von overframe.gg')} <ExternalLink size={12} />
            </button>
          </div>
        </div>
        <Show when={recent().length > 0}>
          <div class="bld-recent">
            <span class="muted small">
              <History size={14} /> {t('Zuletzt angesehen')}
            </span>
            <div class="bld-chips">
              <For each={recent()}>
                {(n) => (
                  <button classList={{ active: n === item() }} onClick={() => pick(n)}>
                    <ItemIcon src={byName().get(n.toLowerCase())?.image} size={22} />
                    {n}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Show when={db.error}>
          <p class="err">{db.error.message}</p>
        </Show>
        <Show when={!item() || showGear()}>
          <Show
            when={gear().length}
            fallback={
              <Show when={!item()}>
                <div class="empty">
                  <Wrench size={30} />
                  <h2>{t('Builds von Overframe')}</h2>
                  <p>{t('Such oben nach einem Warframe, einer Waffe oder einem Begleiter. Nach einem Sync mit dem Spiel siehst du hier auch deine eigene Ausrüstung.')}</p>
                </div>
              </Show>
            }
          >
            <MyGear gear={gear()} onPick={pick} />
          </Show>
        </Show>
        <Show when={item() && !showGear()}>
          <div class="bld-cols">
            <aside class="bld-side">
              <div class="bld-item">
                <ItemIcon src={current()?.image} size={56} />
                <div>
                  <h2>{item()}</h2>
                  <Show when={current()}>
                    <small class="muted">{t(current().category)}</small>
                  </Show>
                </div>
                <div class="seg seg-text bld-sort" title={t('Sortierung')}>
                  <button classList={{ active: sort() === 'score' }} onClick={() => setSort('score')}>
                    <ThumbsUp size={13} /> {t('Stimmen')}
                  </button>
                  <button classList={{ active: sort() === 'date' }} onClick={() => setSort('date')}>
                    <ArrowDownUp size={13} /> {t('Neueste')}
                  </button>
                </div>
              </div>
              <Show when={item()} keyed>
                {(name) => <BuildList itemName={name} sort={sort()} selectedId={buildId()} onSelect={setBuildId} />}
              </Show>
            </aside>
            <Show when={buildId()} keyed fallback={<div class="bld-detail" />}>
              {(id) => <BuildDetail id={id} onOpenBuild={setBuildId} items={items()} />}
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

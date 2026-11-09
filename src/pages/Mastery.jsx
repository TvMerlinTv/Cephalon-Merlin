// Mastery-Helfer: Übersicht, was fehlt (mit Fundorten), Fahrplan zum nächsten MR, To-Do-Liste.
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from 'solid-js';
import { ChevronsUp, ListX, Search, RefreshCw, Lock, Check, BookOpen, Coins, Star, ListChecks, Flame, Route } from 'lucide-solid';
import { loadMasteryDb, evaluate, compact, wikiFor, todo, removeTodo } from '../lib/gamedb.js';
import { game, syncGame } from '../lib/game.js';
import { settings, isFounders } from '../lib/settings.js';
import { openExternal, load, save } from '../lib/ipc.js';
import TodoStar from '../components/TodoStar.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import TodoRelics from '../components/TodoRelics.jsx';
import MasteryRoadmap from '../components/MasteryRoadmap.jsx';
import { blueprintLabel } from '../components/BuildNeeds.jsx';
import { t } from '../lib/i18n.js';
import { materialClick } from '../components/MaterialInfo.jsx';

const PAGE = 48;
const STATUS = { all: 'Alle fehlenden', missing: 'Teile fehlen', blueprints: 'Blaupausen komplett', buildable: 'Baubar', leveling: 'Im Besitz – leveln' };

function Overview(props) {
  const cats = createMemo(() => {
    const m = new Map();
    for (const r of props.rows) {
      const c = m.get(r.item.category) ?? { total: 0, mastered: 0, leveling: 0 };
      c.total++;
      if (r.status === 'mastered') c.mastered++;
      if (r.status === 'leveling') c.leveling++;
      m.set(r.item.category, c);
    }
    return [...m.entries()];
  });
  const count = (s) => props.rows.filter((r) => r.status === s).length;
  const total = () => props.rows.length;
  return (
    <div class="overview">
      <div class="mr-head">
        <span class="mr-big">{props.inv?.player.mr ?? '–'}</span>
        <div class="mr-bar-wrap">
          <div class="mr-bar-label">
            <span>{t('{p} % gemeistert', { p: Math.round((count('mastered') / Math.max(1, total())) * 100) })}</span>
            <span>
              {count('mastered')} / {total()} Items
            </span>
          </div>
          <div class="bar">
            <i style={{ width: `${(count('mastered') / Math.max(1, total())) * 100}%` }} />
          </div>
        </div>
      </div>
      <div class="cat-grid">
        <For each={cats()}>
          {([name, c]) => (
            <div class="cat-card">
              <div class="cat-title">
                <b>{t(name)}</b>
                <span class="accent">{Math.round((c.mastered / c.total) * 100)} %</span>
              </div>
              <div class="bar small">
                <i style={{ width: `${(c.mastered / c.total) * 100}%` }} />
              </div>
              <div class="muted small">{t('{a}/{b} gemeistert · {c} in Arbeit', { a: c.mastered, b: c.total, c: c.leveling })}</div>
            </div>
          )}
        </For>
      </div>
      <p class="muted small">
        {t(
          '{a} Items kannst du sofort bauen (Teile, Rohstoffe und Credits vorhanden). Bei {b} weiteren hast du alle Blaupausen, es fehlen aber noch Rohstoffe oder gebaute Bauteile.',
          { a: count('buildable'), b: count('blueprints') },
        )}
      </p>
    </div>
  );
}

/** Wiki-Seite, auf der steht, wo man ein Bauteil farmt. */
function partWiki(part, item) {
  if (!part.id.includes('/Recipes/')) return wikiFor(part.name);
  return item.wiki ? `${item.wiki}#Acquisition` : wikiFor(item.name);
}

function PartChip(props) {
  const p = props.part;
  const ok = p.built >= p.count;
  const bpOnly = !ok && p.built + p.bp >= p.count;
  const title = p.drops.length
    ? p.drops.map((d) => `${d.location}${d.chance != null ? ` – ${d.chance}%` : ''}`).join('\n')
    : t('Kein Drop bekannt (Markt, Clan-Dojo oder Händler)');
  return (
    <li class="part" classList={{ ok, bp: bpOnly }} title={title} onClick={props.onOpen}>
      <span class="part-name">
        <Show when={ok}>
          <Check size={12} />
        </Show>{' '}
        {p.name}
      </span>
      <span class="part-count">
        {Math.min(p.built + p.bp, p.count)}/{p.count}
        {bpOnly ? ' BP' : ''}
      </span>
      <button
        class="part-wiki"
        onClick={(e) => {
          e.stopPropagation();
          openExternal(partWiki(p, props.item));
        }}
        title={t('Im Wiki nachsehen, wie man es farmt')}
      >
        <BookOpen size={13} /> Wiki
      </button>
      <Show when={!ok && !bpOnly && p.drops[0]}>
        <span class="part-drop">{p.drops[0].location}</span>
      </Show>
      <Show when={bpOnly}>
        <span class="part-drop">{t('Blaupause vorhanden – Bauteil muss noch gebaut werden')}</span>
      </Show>
    </li>
  );
}

function MissingCard(props) {
  const r = () => props.row;
  const missingRes = () => r().resources.filter((x) => x.built < x.count);
  return (
    <article class={`mastery-card status-${r().status}`} onClick={() => props.onOpen()}>
      <div class="mastery-head">
        <div class="item-img sm">
          <Show when={r().item.image}>
            <img src={r().item.image} alt="" loading="lazy" />
          </Show>
        </div>
        <div class="mastery-title">
          <span class="item-name">{r().item.name}</span>
          <div class="mastery-tags">
            <span class="tag">{t(r().item.category)}</span>
            <Show when={r().item.masteryReq > 0}>
              <span class="tag">MR {r().item.masteryReq}</span>
            </Show>
            <Show when={r().item.vaulted}>
              <span class="tag tag-vault">
                <Lock size={11} /> Vaulted
              </span>
            </Show>
          </div>
        </div>
        <div class="mastery-side">
          <span class={`status-chip ${r().status}`}>
            {r().status === 'mastered' && t('Gemeistert')}
            {r().status === 'leveling' && t('Rang {a}/{b}', { a: r().rank, b: r().item.maxRank })}
            {r().status === 'buildable' && t('Baubar')}
            {r().status === 'blueprints' && blueprintLabel(r())}
            {r().status === 'missing' && t('Fehlt')}
          </span>
          <TodoStar id={r().item.id} />
        </div>
      </div>
      <Show when={r().status !== 'leveling' && r().status !== 'mastered'}>
        <Show when={r().parts.length} fallback={<p class="muted small">{t('Keine Blaupause bekannt – Markt, Dojo, Händler oder Quest.')}</p>}>
          <ul class="parts">
            <For each={r().parts}>
              {(p) => (
                <PartChip
                  part={p}
                  item={r().item}
                  onOpen={(e) => {
                    e.stopPropagation();
                    props.onOpen(p.id);
                  }}
                />
              )}
            </For>
          </ul>
        </Show>
        <Show when={missingRes().length > 0 || !r().creditsOk}>
          <div class="res-missing">
            <span class="muted">{t('Es fehlen:')}</span>
            <Show when={!r().creditsOk}>
              <span class="res-chip">
                <Coins size={12} /> {compact(r().item.credits)} Credits
              </span>
            </Show>
            <For each={missingRes()}>
              {(x) => (
                <span class="res-chip bn-click" onClick={materialClick(x)} title={t('{a} von {b}', { a: x.built, b: x.count })}>
                  {x.name} {compact(x.built)}/{compact(x.count)}
                </span>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </article>
  );
}

function Missing(props) {
  const [status, setStatus] = createSignal('all');
  const [category, setCategory] = createSignal('all');
  const [query, setQuery] = createSignal('');
  const [limit, setLimit] = createSignal(PAGE);
  const reset = (fn) => (v) => {
    fn(v);
    setLimit(PAGE);
  };
  const categories = createMemo(() => [...new Set(props.rows.map((r) => r.item.category))]);
  const open = createMemo(() => props.rows.filter((r) => r.status !== 'mastered'));
  const counts = createMemo(() => Object.fromEntries(Object.keys(STATUS).map((id) => [id, id === 'all' ? open().length : open().filter((r) => r.status === id).length])));
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    return open()
      .filter((r) => status() === 'all' || r.status === status())
      .filter((r) => category() === 'all' || r.item.category === category())
      .filter((r) => !q || r.item.name.toLowerCase().includes(q));
  });
  return (
    <>
      <div class="toolbar">
        <div class="seg seg-text">
          <For each={Object.entries(STATUS)}>
            {([id, label]) => (
              <button classList={{ active: status() === id }} onClick={() => reset(setStatus)(id)}>
                {t(label)} <span class="count">{counts()[id]}</span>
              </button>
            )}
          </For>
        </div>
        <div class="toolbar-right">
          <label class="select">
            <select value={category()} onChange={(e) => reset(setCategory)(e.currentTarget.value)}>
              <option value="all">{t('Alle Kategorien')}</option>
              <For each={categories()}>{(c) => <option value={c}>{t(c)}</option>}</For>
            </select>
          </label>
          <label class="search">
            <Search size={15} />
            <input value={query()} onInput={(e) => reset(setQuery)(e.currentTarget.value)} placeholder={t('Suchen')} />
          </label>
        </div>
      </div>
      <div class="card-grid three">
        <For each={shown().slice(0, limit())}>{(r) => <MissingCard row={r} onOpen={(partId) => props.onOpen(r.item, partId)} />}</For>
      </div>
      <Show when={shown().length > limit()}>
        <button class="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          {t('Mehr anzeigen ({n} weitere)', { n: shown().length - limit() })}
        </button>
      </Show>
      <Show when={shown().length === 0}>
        <div class="empty">{t('Nichts offen in dieser Ansicht. 🎉')}</div>
      </Show>
    </>
  );
}

/** Sammelliste: was für alle To-Do-Items noch fehlt (Teile mit Fundort, Rohstoffe summiert). */
function FarmList(props) {
  const data = createMemo(() => {
    const open = props.rows.filter((r) => r.status !== 'mastered' && r.status !== 'leveling');
    const parts = open.flatMap((r) => r.parts.filter((p) => p.built + p.bp < p.count).map((p) => ({ ...p, item: r.item })));
    const toBuild = open.flatMap((r) => r.parts.filter((p) => p.built < p.count && p.built + p.bp >= p.count).map((p) => ({ ...p, item: r.item })));
    const resources = new Map();
    let credits = 0;
    for (const r of open) {
      credits += r.item.credits ?? 0;
      for (const res of r.resources) {
        const e = resources.get(res.id) ?? { ...res, need: 0 };
        e.need += res.count;
        resources.set(res.id, e);
      }
    }
    const res = [...resources.values()];
    const haveCredits = props.inv?.player.credits ?? 0;
    const done = !parts.length && !toBuild.length && !res.some((r) => r.built < r.need) && haveCredits >= credits;
    return { parts, toBuild, res, credits, haveCredits, done };
  });
  return (
    <Show when={!data().done} fallback={<p class="notice ok-notice">{t('Für deine To-Do-Items fehlt nichts mehr – ab in die Foundry! 🎉')}</p>}>
      <section class="farm-list">
        <h3>{t('Noch zu farmen')}</h3>
        <div class="farm-cols">
          <div>
            <h4>{t('Bauteile & Blaupausen ({n})', { n: data().parts.length })}</h4>
            <ul>
              <For each={data().parts}>
                {(p) => (
                  <li onClick={() => props.onOpen(p.item, p.id)}>
                    <span class="farm-name">
                      <b>{p.item.name}</b> {p.name}
                      {p.count > 1 ? ` (${p.built + p.bp}/${p.count})` : ''}
                    </span>
                    <span class="farm-where">{p.drops[0]?.location ?? t('Markt / Dojo / Händler')}</span>
                    <button
                      class="part-wiki"
                      onClick={(e) => {
                        e.stopPropagation();
                        openExternal(partWiki(p, p.item));
                      }}
                    >
                      <BookOpen size={13} /> Wiki
                    </button>
                  </li>
                )}
              </For>
              <Show when={data().parts.length === 0}>
                <li class="muted">{t('Alle Blaupausen und Teile vorhanden.')}</li>
              </Show>
            </ul>
            <Show when={data().toBuild.length > 0}>
              <h4>{t('Noch in der Foundry bauen ({n})', { n: data().toBuild.length })}</h4>
              <ul>
                <For each={data().toBuild}>
                  {(p) => (
                    <li onClick={() => props.onOpen(p.item, p.id)}>
                      <span class="farm-name">
                        <b>{p.item.name}</b> {p.name}
                      </span>
                      <span class="farm-where">{t('Blaupause vorhanden')}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <div>
            <h4>{t('Rohstoffe & Credits')}</h4>
            <ul class="res-list">
              <li class={data().haveCredits >= data().credits ? 'ok' : 'bad'}>
                <Coins size={14} /> Credits
                <span>
                  {compact(data().haveCredits)}/{compact(data().credits)}
                </span>
              </li>
              <For each={data().res}>
                {(r) => (
                  <li class={`${r.built >= r.need ? 'ok' : 'bad'} bn-click`} onClick={materialClick({ ...r, count: r.need })}>
                    <Show when={r.image}>
                      <img src={r.image} alt="" />
                    </Show>{' '}
                    {r.name}
                    <span>
                      {compact(r.built)}/{compact(r.need)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </section>
    </Show>
  );
}

function Todo(props) {
  const [sub, setSub] = createSignal(load('cm.todo.sub', 'list'));
  const pickSub = (v) => {
    setSub(v);
    save('cm.todo.sub', v);
  };
  const list = createMemo(() => {
    const byId = new Map(props.rows.map((r) => [r.item.id, r]));
    return todo()
      .map((id) => byId.get(id))
      .filter(Boolean);
  });
  const done = () => list().filter((r) => r.status === 'mastered');
  return (
    <>
      <div class="sub-tabs">
        <button classList={{ active: sub() === 'list' }} onClick={() => pickSub('list')}>
          <ListChecks size={15} /> {t('Übersicht')}
        </button>
        <button classList={{ active: sub() === 'relics' }} onClick={() => pickSub('relics')}>
          <Flame size={15} /> {t('Relikte')}
        </button>
      </div>
      <Switch>
        <Match when={sub() === 'relics'}>
          <TodoRelics rows={list()} inv={props.inv} onOpen={props.onOpen} />
        </Match>
        <Match when={!list().length}>
          <div class="empty">
            <Star size={32} class="accent" />
            <h2>{t('Deine To-Do-Liste ist leer')}</h2>
            <p>{t('Klick im Tab „Fehlt“ oder im Details-Fenster auf den ☆, um ein Item hinzuzufügen.')}</p>
          </div>
        </Match>
        <Match when={true}>
          <FarmList rows={list()} inv={props.inv} onOpen={props.onOpen} />
          <div class="todo-head">
            <h3>
              {t('Meine Items')} <span class="count">{list().length}</span>
            </h3>
            <Show when={done().length > 0}>
              <button class="btn" onClick={() => done().forEach((r) => removeTodo(r.item.id))}>
                <Check size={15} /> {t('{n} gemeisterte entfernen', { n: done().length })}
              </button>
            </Show>
          </div>
          <div class="card-grid three">
            <For each={list()}>{(r) => <MissingCard row={r} onOpen={(partId) => props.onOpen(r.item, partId)} />}</For>
          </div>
        </Match>
      </Switch>
    </>
  );
}

export default function Mastery() {
  const [db] = createResource(() => loadMasteryDb());
  const [tab, setTabState] = createSignal(load('cm.mastery.tab', 'missing'));
  const setTab = (v) => {
    setTabState(v);
    save('cm.mastery.tab', v);
  };
  const [details, setDetails] = createSignal(null);
  const rows = createMemo(() => {
    const d = db();
    if (!d) return [];
    const inv = game.inventory;
    // Founders-Items (nicht mehr erhältlich) auf Wunsch weglassen – außer man hat sie
    return d.items.map((i) => evaluate(i, inv)).filter((r) => !settings.hideFounders || !isFounders(r.item) || r.owned || r.xp > 0);
  });
  const open = (item, partId = null) => setDetails({ item, partId });

  return (
    <Switch>
      <Match when={db.error}>
        <div class="empty">{t('Item-Datenbank nicht ladbar: {e}', { e: db.error.message })}</div>
      </Match>
      <Match when={!db()}>
        <div class="empty">{t('Lade Item-Datenbank (WFCD) … beim ersten Mal ein paar Sekunden.')}</div>
      </Match>
      <Match when={true}>
        <div class="page">
          <div class="page-tabs">
            <button classList={{ active: tab() === 'overview' }} onClick={() => setTab('overview')}>
              <ChevronsUp size={16} /> {t('Übersicht')}
            </button>
            <button classList={{ active: tab() === 'missing' }} onClick={() => setTab('missing')}>
              <ListX size={16} /> {t('Fehlt')}
            </button>
            <button classList={{ active: tab() === 'roadmap' }} onClick={() => setTab('roadmap')}>
              <Route size={16} /> {t('Fahrplan')}
            </button>
            <button classList={{ active: tab() === 'todo' }} onClick={() => setTab('todo')}>
              <Star size={16} /> To-Do{' '}
              <Show when={todo().length > 0}>
                <span class="count">{todo().length}</span>
              </Show>
            </button>
            <Show when={!game.inventory}>
              <button class="btn btn-primary push-right" onClick={syncGame} disabled={game.syncing}>
                <RefreshCw size={15} class={game.syncing ? 'spin' : ''} /> {t('Mit Spiel synchronisieren')}
              </button>
            </Show>
          </div>
          <Show when={!game.inventory}>
            <p class="notice">{t('Noch keine Spieldaten – ohne Sync wird alles als „fehlt“ angezeigt.')}</p>
          </Show>
          <Switch>
            <Match when={tab() === 'overview'}>
              <Overview rows={rows()} inv={game.inventory} />
            </Match>
            <Match when={tab() === 'missing'}>
              <Missing rows={rows()} onOpen={open} />
            </Match>
            <Match when={tab() === 'roadmap'}>
              <MasteryRoadmap rows={rows()} inv={game.inventory} onOpen={(item) => open(item)} />
            </Match>
            <Match when={tab() === 'todo'}>
              <Todo rows={rows()} inv={game.inventory} onOpen={open} />
            </Match>
          </Switch>
          <Show when={details()}>
            <ItemDetails item={details().item} partId={details().partId} onClose={() => setDetails(null)} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

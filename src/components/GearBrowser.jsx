// Auswahl im AlecaFrame-Stil: Kategorie-Leiste oben, darunter Karten mit Bild und Bauteilen.
// Wird im Markt (Klick = Angebote) und in der Foundry (Klick = Bauplan) benutzt.
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Infinity as All, PersonStanding, Crosshair, Target, Sword, Plane, PawPrint, Bot, Filter, Check, Archive, ArchiveRestore, BadgeCheck, RotateCcw } from 'lucide-solid';
import { loadMasteryDb, loadBulkPrices, builtCount, blueprintOnlyCount, evaluate, todo, compact } from '../lib/gamedb.js';
import { getItems } from '../lib/market.js';
import { game } from '../lib/game.js';
import { settings, isFounders } from '../lib/settings.js';
import { load, save } from '../lib/ipc.js';
import { Plat, Ducat } from './Icons.jsx';
import TodoStar from './TodoStar.jsx';
import HoverSearch from './HoverSearch.jsx';
import { t } from '../lib/i18n.js';

const TABS = [
  { id: 'all', label: 'Alle', icon: All, cats: null },
  { id: 'frames', label: 'Warframe', icon: PersonStanding, cats: ['Warframes'] },
  { id: 'primary', label: 'Primary', icon: Crosshair, cats: ['Primär'] },
  { id: 'secondary', label: 'Secondary', icon: Target, cats: ['Sekundär'] },
  { id: 'melee', label: 'Melee', icon: Sword, cats: ['Nahkampf'] },
  { id: 'arch', label: 'Archwing', icon: Plane, cats: ['Archwing', 'Arch-Gun', 'Arch-Melee'] },
  { id: 'pets', label: 'Begleiter', icon: PawPrint, cats: ['Begleiter'] },
  { id: 'petweapons', label: 'Begleiter-Waffen', icon: Bot, cats: ['Begleiter-Waffen'] },
];

// Filter-Gruppen: je zwei Knöpfe, ein zweiter Klick hebt die Auswahl auf.
const GROUPS = [
  { id: 'type', title: 'Typ', labels: ['Prime', 'Normal'], test: (it) => it.isPrime },
  { id: 'mastery', title: 'Mastery', labels: ['Gemeistert', 'Nicht gemeistert'], test: (it, s) => s.xp >= it.maxXp },
  { id: 'owned', title: 'Im Besitz', test: (it, s) => s.owned },
  { id: 'vaulted', title: 'Vaulted', test: (it) => !!(it.isPrime && it.vaulted) },
  { id: 'build', title: 'Baubar', test: (it, s) => s.status() === 'buildable' },
  { id: 'mr', title: 'Genug Mastery-Rang', test: (it, s) => s.mr >= (it.masteryReq ?? 0) },
  { id: 'crafting', title: 'Wird für anderes gebraucht', test: (it, s) => s.usedIn.has(it.id) },
  { id: 'fav', title: 'Favorit (Stern)', test: (it, s) => s.todo.has(it.id) },
];
const PAGE = 48;

function FilterPanel(props) {
  let ref;
  const onDown = (e) => !ref?.parentElement.contains(e.target) && props.onClose();
  onMount(() => window.addEventListener('mousedown', onDown));
  onCleanup(() => window.removeEventListener('mousedown', onDown));
  const pick = (id, v) => {
    const next = { ...props.filters };
    if (next[id] === v) delete next[id];
    else next[id] = v;
    props.setFilters(next);
  };
  return (
    <div class="gb-filters" ref={ref}>
      <For each={GROUPS}>
        {(g) => (
          <div class="gb-fgroup">
            <b>{t(g.title)}</b>
            <div>
              <For each={[true, false]}>
                {(v, i) => (
                  <button classList={{ on: props.filters[g.id] === v }} onClick={() => pick(g.id, v)}>
                    {t((g.labels ?? ['Ja', 'Nein'])[i()])}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
      <button class="gb-freset" onClick={() => props.setFilters({})}>
        <RotateCcw size={13} /> {t('Alle Filter zurücksetzen')}
      </button>
    </div>
  );
}

function PartCircle(props) {
  const p = props.part;
  const isResource = p.kind === 'resource';
  const have = () => (isResource ? builtCount(game.inventory, p.id) : builtCount(game.inventory, p.id) + blueprintOnlyCount(game.inventory, p.id));
  const tradeable = !isResource && p.ducats > 0;
  return (
    <button
      class="gb-part"
      classList={{ ok: have() > 0 && have() >= p.count, some: have() > 0 && have() < p.count, prime: tradeable }}
      title={`${p.name}${p.count > 1 ? ` ×${p.count}` : ''} – ${t('vorhanden: {n}', { n: have() })}${tradeable ? ` ${t('(handelbar)')}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onPick(p);
      }}
    >
      {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span class="gb-part-txt">{p.name.slice(0, 2)}</span>}
      <Show when={have() > 0}>
        <i class="gb-count">{compact(have())}</i>
      </Show>
      <Show when={tradeable}>
        <i class="gb-ducat">
          <Ducat size={10} />
        </i>
      </Show>
    </button>
  );
}

function GearCard(props) {
  const it = props.item;
  const owned = () => (game.inventory?.owned[it.id] ?? 0) > 0;
  const mastered = () => (game.inventory?.xp[it.id] ?? 0) >= it.maxXp;
  return (
    <div class="gb-card" classList={{ owned: owned() }} onClick={() => props.onPick(it)} role="button" tabIndex={0}>
      <div class="gb-head">
        <span onClick={(e) => e.stopPropagation()}>
          <TodoStar id={it.id} size={16} />
        </span>
        <b>{it.name}</b>
        <Show when={mastered()}>
          <BadgeCheck size={17} class="gb-mastered" />
        </Show>
      </div>
      <div class="gb-body">
        <div class="gb-img">
          <Show when={it.image}>
            <img src={it.image} alt="" loading="lazy" />
          </Show>
        </div>
        <div class="gb-parts">
          <For each={it.components.slice(0, 6)}>{(p) => <PartCircle part={p} onPick={(part) => props.onPickPart(it, part)} />}</For>
        </div>
      </div>
      <div class="gb-foot">
        <Show when={it.isPrime}>
          {it.vaulted ? (
            <span>
              <Archive size={14} /> Vaulted
            </span>
          ) : (
            <span>
              <ArchiveRestore size={14} /> Unvaulted
            </span>
          )}
        </Show>
        <Show when={owned()}>
          <span class="gb-owned">
            <Check size={13} /> Owned
          </span>
        </Show>
        <Show when={props.price > 0}>
          <span class="gb-price">
            {Math.round(props.price)} <Plat size={12} />
          </span>
        </Show>
        <Show when={it.category !== 'Warframes' && it.masteryReq > 0}>
          <span>
            MR: <b>{it.masteryReq}</b>
          </span>
        </Show>
      </div>
    </div>
  );
}

/** mode: 'market' (mit Haken "Nur kaufbare") oder 'foundry' */
export default function GearBrowser(props) {
  const mode = props.mode ?? 'market';
  const [db] = createResource(() => loadMasteryDb());
  const [prices] = createResource(() => loadBulkPrices().catch(() => ({})));
  const [market] = createResource(() =>
    mode === 'market'
      ? getItems()
          .then((items) => ({ names: new Set(items.map((i) => i.name.toLowerCase())), refs: new Set(items.map((i) => i.gameRef).filter(Boolean)) }))
          .catch(() => null)
      : null,
  );
  const [tab, setTabS] = createSignal(load(`cm.${mode}.tab`, 'all'));
  const [filters, setFiltersS] = createSignal(load(`cm.${mode}.filters.v1`, {}));
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [limit, setLimit] = createSignal(PAGE);
  const [tradeOnly, setTradeOnlyS] = createSignal(load('cm.market.tradeOnly.v1', false));
  const setTab = (v) => (setTabS(v), save(`cm.${mode}.tab`, v), setLimit(PAGE));
  const setFilters = (v) => (setFiltersS(v), save(`cm.${mode}.filters.v1`, v), setLimit(PAGE));
  const setTradeOnly = (v) => (setTradeOnlyS(v), save('cm.market.tradeOnly.v1', v), setLimit(PAGE));

  const tradeable = (it) => {
    const m = market();
    return !m || m.names.has(`${it.name} set`.toLowerCase()) || m.names.has(it.name.toLowerCase()) || m.refs.has(it.id);
  };
  const usedIn = createMemo(() => new Set(db()?.items.flatMap((it) => it.components.map((c) => c.id)) ?? []));
  const list = createMemo(() => {
    const d = db();
    if (!d) return [];
    const inv = game.inventory;
    const cats = TABS.find((x) => x.id === tab())?.cats;
    const q = query().trim().toLowerCase();
    const todoSet = new Set(todo());
    const mr = inv?.player.mr ?? 0;
    const active = Object.entries(filters());
    return d.items
      .filter((it) => !cats || cats.includes(it.category))
      .filter((it) => !q || it.name.toLowerCase().includes(q))
      .filter((it) => !settings.hideFounders || !isFounders(it) || (inv?.owned[it.id] ?? 0) > 0)
      .filter((it) => {
        if (!active.length) return true;
        let status;
        const s = { owned: (inv?.owned[it.id] ?? 0) > 0, xp: inv?.xp[it.id] ?? 0, mr, usedIn: usedIn(), todo: todoSet, status: () => (status ??= evaluate(it, inv).status) };
        return active.every(([id, want]) => GROUPS.find((g) => g.id === id)?.test(it, s) === want);
      })
      .filter((it) => mode !== 'market' || !tradeOnly() || tradeable(it))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  return (
    <Show when={db()} fallback={db.error ? <p class="err">{db.error.message}</p> : <div class="empty">{t('Lade Item-Datenbank …')}</div>}>
      <div class="gb">
        <div class="gb-bar">
          <For each={TABS}>
            {(x) => (
              <button class="gb-tab" classList={{ active: x.id === tab() }} onClick={() => setTab(x.id)} title={t(x.label)}>
                <Dynamic component={x.icon} size={17} />
                <Show when={x.id === tab()}>
                  <span>{t(x.label)}</span>
                </Show>
              </button>
            )}
          </For>
          <div class="gb-spacer" />
          <Show when={mode === 'market'}>
            <label class="gb-check" title={t('Items ausblenden, die es auf warframe.market nicht gibt')}>
              <input type="checkbox" checked={tradeOnly()} onChange={(e) => setTradeOnly(e.currentTarget.checked)} />
              {t('Nur kaufbare')}
            </label>
          </Show>
          <HoverSearch
            value={query()}
            onChange={(v) => {
              setQuery(v);
              setLimit(PAGE);
            }}
          />
          <div class="gb-filterwrap">
            <button class="gb-tab" classList={{ active: Object.keys(filters()).length > 0 }} onClick={() => setFilterOpen((o) => !o)} title={t('Filter')}>
              <Filter size={17} />
              <Show when={Object.keys(filters()).length > 0}>
                <span>{Object.keys(filters()).length}</span>
              </Show>
            </button>
            <Show when={filterOpen()}>
              <FilterPanel filters={filters()} setFilters={setFilters} onClose={() => setFilterOpen(false)} />
            </Show>
          </div>
        </div>
        <Show when={list().length === 0}>
          <div class="empty">{t('Nichts gefunden.')}</div>
        </Show>
        <div class="gb-grid">
          <For each={list().slice(0, limit())}>
            {(it) => <GearCard item={it} price={it.isPrime ? (prices() ?? {})[`${it.name} set`.toLowerCase()] : 0} onPick={props.onPick} onPickPart={props.onPickPart} />}
          </For>
        </div>
        <Show when={list().length > limit()}>
          <button class="btn gb-more" onClick={() => setLimit((l) => l + PAGE * 2)}>
            {t('Mehr anzeigen ({n} weitere)', { n: list().length - limit() })}
          </button>
        </Show>
      </div>
    </Show>
  );
}

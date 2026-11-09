import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Infinity as All, PersonStanding, Crosshair, Target, Sword, Plane, PawPrint, Bot,
  Search, Filter, Check, Archive, ArchiveRestore, BadgeCheck, Trash2, RotateCcw,
} from 'lucide-react';
import { useMasteryDb } from '../lib/masteryDb.js';
import { useGameData, builtCount, blueprintOnlyCount } from '../lib/GameData.jsx';
import { getBulkPrices, getItems, load, save } from '../lib/api.js';
import { evaluate } from '../lib/evaluate.js';
import { useTodo } from '../lib/todo.js';
import { useSettings, isFounders } from '../lib/settings.js';
import { compact } from '../lib/format.js';
import { Plat, Ducat } from './Icons.jsx';
import TodoStar from './TodoStar.jsx';
import { useT } from '../lib/i18n.js';

// Auswahl im AlecaFrame-Stil: Kategorie-Leiste oben, darunter Karten mit Bild und Bauteilen.
// Wird im Markt (Klick = Angebote) und in der Foundry (Klick = Bauplan) benutzt.

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

// Filter-Gruppen wie bei AlecaFrame: je zwei Knöpfe, ein zweiter Klick hebt die Auswahl auf.
// test(item, s) gilt für den ersten Knopf, der zweite ist das Gegenteil.
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
const TRADE_KEY = 'td.market.tradeOnly.v1';

/** Suchfeld, das nur beim Drüberfahren (oder beim Tippen) aufklappt. */
export function HoverSearch({ value, onChange }) {
  const t = useT();
  return (
    <div className={`gb-searchbox ${value ? 'has-value' : ''}`}>
      <Search size={17} className="gb-search-ico" />
      <input placeholder={t('Suchen')} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button className="gb-search-clear" onClick={() => onChange('')} title={t('Suche leeren')}>
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function FilterPanel({ filters, setFilters, onClose }) {
  const ref = useRef(null);
  const t = useT();
  useEffect(() => {
    // Klick außerhalb (auch nicht auf den Filter-Knopf) schließt das Fenster
    const onDown = (e) => !ref.current?.parentElement.contains(e.target) && onClose();
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const pick = (id, v) =>
    setFilters((f) => {
      const next = { ...f };
      if (next[id] === v) delete next[id];
      else next[id] = v;
      return next;
    });
  return (
    <div className="gb-filters" ref={ref}>
      {GROUPS.map((g) => (
        <div key={g.id} className="gb-fgroup">
          <b>{t(g.title)}</b>
          <div>
            {[true, false].map((v, i) => (
              <button key={i} className={filters[g.id] === v ? 'on' : ''} onClick={() => pick(g.id, v)}>
                {t((g.labels ?? ['Ja', 'Nein'])[i])}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="gb-freset" onClick={() => setFilters({})}>
        <RotateCcw size={13} /> {t('Alle Filter zurücksetzen')}
      </button>
    </div>
  );
}

function PartCircle({ part, inv, onPick }) {
  const t = useT();
  const isResource = part.kind === 'resource';
  const have = isResource ? builtCount(inv, part.id) : builtCount(inv, part.id) + blueprintOnlyCount(inv, part.id);
  const enough = have >= part.count;
  const tradeable = !isResource && part.ducats > 0;
  return (
    <button
      className={`gb-part ${have > 0 ? (enough ? 'ok' : 'some') : ''} ${tradeable ? 'prime' : ''}`}
      title={`${part.name}${part.count > 1 ? ` ×${part.count}` : ''} – ${t('vorhanden: {n}', { n: have })}${tradeable ? ` ${t('(handelbar)')}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(part);
      }}
    >
      {part.image ? <img src={part.image} alt="" loading="lazy" /> : <span className="gb-part-txt">{part.name.slice(0, 2)}</span>}
      {have > 0 && <i className="gb-count">{compact(have)}</i>}
      {tradeable && (
        <i className="gb-ducat">
          <Ducat size={10} />
        </i>
      )}
    </button>
  );
}

function GearCard({ item, inv, price, onPick, onPickPart }) {
  const owned = (inv?.owned[item.id] ?? 0) > 0;
  const mastered = (inv?.xp[item.id] ?? 0) >= item.maxXp;
  const parts = item.components.slice(0, 6);
  return (
    <div className={`gb-card ${owned ? 'owned' : ''}`} onClick={() => onPick(item)} role="button" tabIndex={0}>
      <div className="gb-head">
        <span onClick={(e) => e.stopPropagation()}>
          <TodoStar id={item.id} size={16} />
        </span>
        <b>{item.name}</b>
        {mastered && <BadgeCheck size={17} className="gb-mastered" aria-label="Gemeistert" />}
      </div>
      <div className="gb-body">
        <div className="gb-img">{item.image && <img src={item.image} alt="" loading="lazy" />}</div>
        <div className="gb-parts">
          {parts.map((p) => (
            <PartCircle key={p.id} part={p} inv={inv} onPick={(part) => onPickPart(item, part)} />
          ))}
        </div>
      </div>
      <div className="gb-foot">
        {item.isPrime &&
          (item.vaulted ? (
            <span>
              <Archive size={14} /> Vaulted
            </span>
          ) : (
            <span>
              <ArchiveRestore size={14} /> Unvaulted
            </span>
          ))}
        {owned && (
          <span className="gb-owned">
            <Check size={13} /> Owned
          </span>
        )}
        {price > 0 && (
          <span className="gb-price">
            {Math.round(price)} <Plat size={12} />
          </span>
        )}
        {item.category !== 'Warframes' && item.masteryReq > 0 && (
          <span>
            MR: <b>{item.masteryReq}</b>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * @param mode   'market' (mit Haken "Nur kaufbare") oder 'foundry'
 * @param onPick(item)            Karte angeklickt
 * @param onPickPart(item, part)  Bauteil angeklickt
 */
export default function GearBrowser({ mode = 'market', onPick, onPickPart }) {
  const { db, error } = useMasteryDb();
  const { inventory: inv } = useGameData();
  const todoList = useTodo();
  const { hideFounders } = useSettings();
  const tr = useT(); // "t" ist unten die Laufvariable der Reiter
  const [tab, setTab] = useState(() => load(`td.${mode}.tab`, 'all'));
  const [filters, setFilters] = useState(() => load(`td.${mode}.filters.v1`, {}));
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [prices, setPrices] = useState({});
  const [tradeOnly, setTradeOnly] = useState(() => load(TRADE_KEY, false));
  const [market, setMarket] = useState(null); // { names, refs } aller warframe.market-Items

  useEffect(() => {
    getBulkPrices().then(setPrices).catch(() => {});
    if (mode !== 'market') return;
    getItems()
      .then((items) => setMarket({ names: new Set(items.map((i) => i.name.toLowerCase())), refs: new Set(items.map((i) => i.gameRef).filter(Boolean)) }))
      .catch(() => {});
  }, [mode]);
  useEffect(() => setLimit(PAGE), [tab, filters, query, tradeOnly]);
  useEffect(() => save(`td.${mode}.tab`, tab), [mode, tab]);
  useEffect(() => save(`td.${mode}.filters.v1`, filters), [mode, filters]);

  // Kaufbar = es gibt das Set oder das Item selbst auf warframe.market
  const tradeable = (it) =>
    !market || market.names.has(`${it.name} set`.toLowerCase()) || market.names.has(it.name.toLowerCase()) || market.refs.has(it.id);
  const toggleTradeOnly = (on) => {
    setTradeOnly(on);
    save(TRADE_KEY, on);
  };

  // Items, die als Bauteil in anderen stecken (Bolto für Akbolto …)
  const usedIn = useMemo(() => new Set(db?.items.flatMap((it) => it.components.map((c) => c.id)) ?? []), [db]);
  const activeFilters = Object.entries(filters);

  const list = useMemo(() => {
    if (!db) return [];
    const cats = TABS.find((t) => t.id === tab)?.cats;
    const q = query.trim().toLowerCase();
    const todo = new Set(todoList);
    const mr = inv?.player.mr ?? 0;
    return db.items
      .filter((it) => !cats || cats.includes(it.category))
      .filter((it) => !q || it.name.toLowerCase().includes(q))
      .filter((it) => !hideFounders || !isFounders(it) || (inv?.owned[it.id] ?? 0) > 0)
      .filter((it) => {
        if (!activeFilters.length) return true;
        let status;
        const s = {
          owned: (inv?.owned[it.id] ?? 0) > 0,
          xp: inv?.xp[it.id] ?? 0,
          mr,
          usedIn,
          todo,
          status: () => (status ??= evaluate(it, inv).status),
        };
        return activeFilters.every(([id, want]) => GROUPS.find((g) => g.id === id)?.test(it, s) === want);
      })
      .filter((it) => mode !== 'market' || !tradeOnly || tradeable(it))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, tab, filters, query, inv, tradeOnly, market, todoList, usedIn, hideFounders]);

  if (error) return <p className="err">{error}</p>;
  if (!db) return <div className="empty">{tr('Lade Item-Datenbank …')}</div>;

  return (
    <div className="gb">
      <div className="gb-bar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button key={t.id} className={`gb-tab ${active ? 'active' : ''}`} onClick={() => setTab(t.id)} title={tr(t.label)}>
              <Icon size={17} />
              {active && <span>{tr(t.label)}</span>}
            </button>
          );
        })}
        <div className="gb-spacer" />
        {mode === 'market' && (
          <label className="gb-check" title={tr('Items ausblenden, die es auf warframe.market nicht gibt')}>
            <input type="checkbox" checked={tradeOnly} onChange={(e) => toggleTradeOnly(e.target.checked)} />
            {tr('Nur kaufbare')}
          </label>
        )}
        <HoverSearch value={query} onChange={setQuery} />
        <div className="gb-filterwrap">
          <button className={`gb-tab ${activeFilters.length ? 'active' : ''}`} onClick={() => setFilterOpen((o) => !o)} title={tr('Filter')}>
            <Filter size={17} />
            {activeFilters.length > 0 && <span>{activeFilters.length}</span>}
          </button>
          {filterOpen && <FilterPanel filters={filters} setFilters={setFilters} onClose={() => setFilterOpen(false)} />}
        </div>
      </div>

      {list.length === 0 && <div className="empty">{tr('Nichts gefunden.')}</div>}
      <div className="gb-grid">
        {list.slice(0, limit).map((it) => (
          <GearCard
            key={it.id}
            item={it}
            inv={inv}
            price={it.isPrime ? prices[`${it.name} set`.toLowerCase()] : 0}
            onPick={onPick}
            onPickPart={onPickPart}
          />
        ))}
      </div>
      {list.length > limit && (
        <button className="btn gb-more" onClick={() => setLimit((l) => l + PAGE * 2)}>
          {tr('Mehr anzeigen ({n} weitere)', { n: list.length - limit })}
        </button>
      )}
    </div>
  );
}

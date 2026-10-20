import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, ThumbsUp, User, Clock, ExternalLink, Loader2, RefreshCw, History, Backpack, MessageSquare, ArrowDownUp, WifiOff,
  ShieldAlert, Wrench, Star, Target, CheckCircle2, Trash2, Search as SearchIcon,
} from 'lucide-react';
import { openExternal } from '../lib/api.js';
import { useMasteryDb } from '../lib/masteryDb.js';
import { useGameData } from '../lib/GameData.jsx';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { compact } from '../lib/format.js';
import { Plat } from '../components/Icons.jsx';
import Markdown from '../components/Markdown.jsx';
import BuildMods, { loadData } from '../components/BuildMods.jsx';
import BuildChecklist, { buildProgress } from '../components/BuildChecklist.jsx';
import { useSavedBuilds, toggleFavorite, toggleActive, removeDone, snapshot } from '../lib/savedBuilds.js';
import { load, save } from '../lib/api.js';
import {
  OVERFRAME, getBuilds, getBuild, buildsErrorKind, loadRecent, pushRecent, loadSelectedItem, saveSelectedItem,
} from '../lib/builds.js';
import './builds.css';

const GEAR_CATEGORIES = ['Warframes', 'Primär', 'Sekundär', 'Nahkampf', 'Begleiter', 'Begleiter-Waffen', 'Archwing', 'Arch-Gun', 'Arch-Melee'];

const ERROR_TEXT = {
  offline: 'Keine Verbindung zu overframe.gg – bist du online?',
  blocked: 'overframe.gg blockiert die Anfrage gerade (Cloudflare-Schutz). Versuch es später noch einmal oder öffne die Seite im Browser.',
  busy: 'overframe.gg ist gerade ausgelastet. Versuch es gleich noch einmal.',
  missing: 'Build nicht gefunden – vielleicht wurde er gelöscht.',
  other: 'Builds konnten nicht geladen werden.',
};

function relTime(iso, language) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(language === 'de' ? 'de' : 'en', { numeric: 'auto' });
  const steps = [
    ['year', 365 * 86400],
    ['month', 30 * 86400],
    ['week', 7 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, sec] of steps) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  return rtf.format(0, 'minute');
}
const fullDate = (iso, language) => new Date(iso).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' });

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function itemFromUrl(url, items) {
  const slug = url?.split('/')[3];
  return slug ? items.find((i) => slugOf(i.name) === slug) ?? null : null;
}

function ItemIcon({ src, size = 28 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="bld-ico-empty" style={{ width: size, height: size }} />;
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
}

function ErrorBox({ error, onRetry, overframeUrl }) {
  const t = useT();
  const kind = buildsErrorKind(error);
  const Icon = kind === 'offline' ? WifiOff : ShieldAlert;
  return (
    <div className="empty bld-error">
      <Icon size={30} />
      <p>{t(ERROR_TEXT[kind])}</p>
      {kind === 'other' && <p className="small">{error?.message}</p>}
      <div className="empty-actions">
        <button className="btn" onClick={onRetry}>
          <RefreshCw size={15} /> {t('Erneut versuchen')}
        </button>
        {overframeUrl && (
          <button className="btn" onClick={() => openExternal(overframeUrl)}>
            <ExternalLink size={15} /> {t('Auf Overframe öffnen')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Suche mit Autovervollständigung ----------
function ItemSearch({ items, onPick }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts = [];
    const contains = [];
    for (const it of items) {
      const n = it.name.toLowerCase();
      if (n.startsWith(q)) starts.push(it);
      else if (n.includes(q)) contains.push(it);
    }
    return [...starts, ...contains].slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    const close = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (name) => {
    onPick(name);
    setQuery('');
    setOpen(false);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      const it = matches[active];
      if (it) pick(it.name);
      else if (query.trim()) pick(query.trim());
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="bld-search" ref={boxRef}>
      <label className="search big">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={t('Item suchen, z. B. Revenant Prime, Glaive, Laetum …')}
          autoFocus
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} title={t('Leeren')}>
            <X size={14} />
          </button>
        )}
      </label>
      {open && matches.length > 0 && (
        <ul className="bld-suggest">
          {matches.map((it, i) => (
            <li key={it.id}>
              <button className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(it.name)}>
                <ItemIcon src={it.image} size={30} />
                <span>{it.name}</span>
                <small className="muted">{t(it.category)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Schnellauswahl ----------
function Chips({ names, byName, onPick, active }) {
  return (
    <div className="bld-chips">
      {names.map((n) => (
        <button key={n} className={n === active ? 'active' : ''} onClick={() => onPick(n)}>
          <ItemIcon src={byName.get(n.toLowerCase())?.image} size={22} />
          {n}
        </button>
      ))}
    </div>
  );
}

function MyGear({ gear, onPick }) {
  const t = useT();
  const [cat, setCat] = useState('all');
  const cats = GEAR_CATEGORIES.filter((c) => gear.some((g) => g.category === c));
  const list = cat === 'all' ? gear : gear.filter((g) => g.category === cat);
  return (
    <section className="bld-gear">
      <div className="bld-gear-head">
        <h3>
          <Backpack size={17} /> {t('Meine Ausrüstung')}
        </h3>
        <div className="filter-pills">
          <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>
            {t('Alle')} <small>{gear.length}</small>
          </button>
          {cats.map((c) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
              {t(c)}
            </button>
          ))}
        </div>
      </div>
      <div className="bld-gear-grid">
        {list.map((g) => (
          <button key={g.id} onClick={() => onPick(g.name)} title={g.name}>
            <ItemIcon src={g.image} size={48} />
            <span>{g.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Build-Liste und Details ----------
function BuildList({ itemName, sort, selectedId, onSelect }) {
  const t = useT();
  const { language } = useSettings();
  const [state, setState] = useState({ loading: true });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    getBuilds(itemName)
      .then((builds) => alive && setState({ builds }))
      .catch((error) => alive && setState({ error }));
    return () => {
      alive = false;
    };
  }, [itemName, retry]);

  const sorted = useMemo(() => {
    const list = [...(state.builds ?? [])];
    if (sort === 'date') list.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    else list.sort((a, b) => b.score - a.score);
    return list;
  }, [state.builds, sort]);

  // Ersten Build gleich öffnen, damit rechts nicht leer bleibt
  useEffect(() => {
    if (sorted.length && !sorted.some((b) => b.id === selectedId)) onSelect(sorted[0].id);
  }, [sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading)
    return (
      <div className="empty">
        <Loader2 size={22} className="spin" />
        <p>{t('Lade Builds von overframe.gg …')}</p>
      </div>
    );
  if (state.error) return <ErrorBox error={state.error} onRetry={() => setRetry((r) => r + 1)} overframeUrl={OVERFRAME} />;
  if (!sorted.length)
    return (
      <div className="empty">
        <Wrench size={28} />
        <p>{t('Für {name} gibt es auf Overframe noch keine Builds.', { name: itemName })}</p>
        <p className="small">{t('Prüfe die Schreibweise – gesucht wird mit dem englischen Item-Namen.')}</p>
      </div>
    );

  return (
    <ul className="bld-list">
      {sorted.map((b) => (
        <li key={b.id}>
          <button className={b.id === selectedId ? 'active' : ''} onClick={() => onSelect(b.id)}>
            <span className="bld-score" title={t('Stimmen')}>
              <ThumbsUp size={13} />
              {compact(b.score)}
            </span>
            <span className="bld-card-main">
              <b className="bld-card-title">{b.title || t('(ohne Titel)')}</b>
              <span className="bld-card-meta">
                <span>
                  <User size={12} /> {b.author?.username ?? '–'}
                </span>
                <span title={t('Forma')}>
                  <span className="bld-forma" /> {b.formas}
                </span>
                <span title={fullDate(b.updated, language)}>
                  <Clock size={12} /> {relTime(b.updated, language)}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BuildDetail({ id, onOpenBuild, items }) {
  const t = useT();
  const { language } = useSettings();
  const [state, setState] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    getBuild(id)
      .then((build) => alive && setState({ build }))
      .catch((error) => alive && setState({ error }));
    scrollRef.current?.scrollTo({ top: 0 });
    return () => {
      alive = false;
    };
  }, [id, retry]);

  const saved = useSavedBuilds();
  const b = state.build;
  const url = b ? OVERFRAME + b.url : `${OVERFRAME}/build/${id}/`;
  const item = b ? itemFromUrl(b.url, items) : null;
  const snap = b ? snapshot(b, item?.name) : null;
  const fav = saved.fav.includes(id);
  const active = saved.active.includes(id);
  const done = saved.done.includes(id);

  return (
    <div className="bld-detail" ref={scrollRef}>
      {state.loading && (
        <div className="empty">
          <Loader2 size={22} className="spin" />
        </div>
      )}
      {state.error && <ErrorBox error={state.error} onRetry={() => setRetry((r) => r + 1)} overframeUrl={url} />}
      {b && (
        <>
          <div className="bld-detail-head">
            <div>
              <h2>{b.title || t('(ohne Titel)')}</h2>
              <p className="muted">
                {t('von {name}', { name: b.author?.username ?? '–' })} · {t('aktualisiert {when}', { when: relTime(b.updated, language) })} (
                {fullDate(b.updated, language)})
              </p>
            </div>
            <div className="bld-detail-actions">
              <button className={`btn ${fav ? 'bld-fav-on' : ''}`} onClick={() => toggleFavorite(snap)} title={t('Zu den Favoriten')}>
                <Star size={15} fill={fav ? 'currentColor' : 'none'} /> {t(fav ? 'Favorit' : 'Favorisieren')}
              </button>
              <button className={`btn ${active ? 'bld-active-on' : ''}`} onClick={() => toggleActive(snap)} title={t('In die Liste „In Arbeit“ – mit Checkliste zum Fertigstellen')}>
                {done ? <CheckCircle2 size={15} /> : <Target size={15} />} {t(active ? 'Wird verfolgt' : done ? 'Fertig – neu verfolgen' : 'Verfolgen')}
              </button>
              <button className="btn btn-primary" onClick={() => openExternal(url)}>
                <ExternalLink size={15} /> {t('Auf Overframe öffnen')}
              </button>
            </div>
          </div>
          <div className="bld-facts">
            <span title={t('Stimmen')}>
              <ThumbsUp size={14} /> {b.score.toLocaleString(language === 'de' ? 'de-DE' : 'en-US')}
            </span>
            <span title={t('Forma')}>
              <span className="bld-forma" /> {b.formas} Forma
            </span>
            {b.mastery_rank > 0 && <span title={t('Mastery-Rang')}>MR {b.mastery_rank}</span>}
            {b.endo_cost > 0 && <span title={t('Endo für alle Mods')}>{compact(b.endo_cost)} Endo</span>}
            {b.platinum_cost > 0 && (
              <span title={t('Ungefährer Platin-Preis der Mods')}>
                <Plat size={14} /> {b.platinum_cost}
              </span>
            )}
            {b.comment_count != null && (
              <span title={t('Kommentare')}>
                <MessageSquare size={14} /> {b.comment_count}
              </span>
            )}
          </div>
          {active && <BuildChecklist snap={snap} item={item} />}
          <BuildMods slots={b.slots} />
          {b.description?.trim() ? (
            <Markdown text={b.description} onOpenBuild={onOpenBuild} />
          ) : (
            <p className="muted">{t('Dieser Build hat keinen Guide-Text.')}</p>
          )}
        </>
      )}
    </div>
  );
}

function SavedList({ tab, selectedId, onSelect, items }) {
  const t = useT();
  const { language } = useSettings();
  const { inventory } = useGameData();
  const saved = useSavedBuilds();
  const [data, setData] = useState(null);
  useEffect(() => {
    loadData()
      .then(setData)
      .catch(() => setData({ mods: {}, market: new Map() }));
  }, []);
  const ids = tab === 'fav' ? saved.fav : saved.active;
  const row = (id, isDone) => {
    const b = saved.builds[id];
    if (!b) return null;
    const item = items.find((i) => i.name === b.item) ?? itemFromUrl(b.url, items);
    const p = !isDone && tab === 'active' && data ? buildProgress(b, data, inventory, saved.checks[id], item) : null;
    return (
      <li key={id}>
        <button className={`${id === selectedId ? 'active' : ''} ${isDone ? 'bld-done' : ''}`} onClick={() => onSelect(id)}>
          <ItemIcon src={item?.image} size={40} />
          <span className="bld-card-main">
            <b className="bld-card-title">{b.title || t('(ohne Titel)')}</b>
            <span className="bld-card-meta">
              <span>{b.item ?? '–'}</span>
              <span>
                <User size={12} /> {b.author ?? '–'}
              </span>
              {!p && (
                <span title={fullDate(b.updated, language)}>
                  <Clock size={12} /> {relTime(b.updated, language)}
                </span>
              )}
            </span>
            {p && (
              <span className="bld-progress" title={t('{a} von {b} erledigt', { a: p.done, b: p.total })}>
                <span className="bc-bar">
                  <i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
                </span>
                <small>
                  {p.done}/{p.total}
                </small>
              </span>
            )}
          </span>
          {isDone && (
            <span
              className="icon-btn"
              role="button"
              title={t('Aus der Liste entfernen')}
              onClick={(e) => {
                e.stopPropagation();
                removeDone(id);
              }}
            >
              <Trash2 size={14} />
            </span>
          )}
        </button>
      </li>
    );
  };
  if (!ids.length && !(tab === 'active' && saved.done.length))
    return (
      <div className="empty">
        {tab === 'fav' ? <Star size={26} /> : <Target size={26} />}
        <p>
          {t(
            tab === 'fav'
              ? 'Noch keine Favoriten. Öffne einen Build und klick auf „Favorisieren“.'
              : 'Noch nichts in Arbeit. Öffne einen Build und klick auf „Verfolgen“ – dann bekommst du eine Checkliste mit allem, was noch fehlt.',
          )}
        </p>
      </div>
    );
  return (
    <ul className="bld-list">
      {ids.map((id) => row(id, false))}
      {tab === 'active' && saved.done.length > 0 && (
        <>
          <li className="bld-list-sep muted small">
            <CheckCircle2 size={13} /> {t('Fertig')} ({saved.done.length})
          </li>
          {saved.done.map((id) => row(id, true))}
        </>
      )}
    </ul>
  );
}

export default function Builds() {
  const t = useT();
  const { db, error: dbError } = useMasteryDb();
  const { inventory } = useGameData();
  const [item, setItem] = useState(() => loadSelectedItem());
  const [recent, setRecent] = useState(() => loadRecent());
  const [sort, setSort] = useState('score');
  const [buildId, setBuildId] = useState(null);
  const [showGear, setShowGear] = useState(false);
  // Suche | Favoriten | In Arbeit (gemerkt)
  const [tab, setTab] = useState(() => load('td.builds.tab', 'search'));
  const [savedId, setSavedId] = useState(null);
  const saved = useSavedBuilds();
  const pickTab = (x) => {
    setTab(x);
    save('td.builds.tab', x);
  };

  const items = useMemo(() => (db?.items ?? []).filter((i) => GEAR_CATEGORIES.includes(i.category)), [db]);
  const byName = useMemo(() => new Map(items.map((i) => [i.name.toLowerCase(), i])), [items]);
  // Eigene Ausrüstung, meistbenutzte (meiste XP) zuerst
  const gear = useMemo(() => {
    if (!inventory) return [];
    return items.filter((i) => (inventory.owned[i.id] ?? 0) > 0).sort((a, b) => (inventory.xp[b.id] ?? 0) - (inventory.xp[a.id] ?? 0));
  }, [items, inventory]);

  const pick = (name) => {
    const canonical = byName.get(name.toLowerCase())?.name ?? name;
    setItem(canonical);
    saveSelectedItem(canonical);
    if (byName.has(canonical.toLowerCase())) setRecent(pushRecent(canonical)); // Tippfehler nicht merken
    setBuildId(null);
    setShowGear(false);
    pickTab('search');
  };

  const current = item ? byName.get(item.toLowerCase()) : null;

  return (
    <div className="page bld">
      <div className="page-tabs bld-tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => pickTab('search')}>
          <SearchIcon size={15} /> {t('Suche')}
        </button>
        <button className={tab === 'fav' ? 'active' : ''} onClick={() => pickTab('fav')}>
          <Star size={15} /> {t('Favoriten')} {saved.fav.length > 0 && <span className="count">{saved.fav.length}</span>}
        </button>
        <button className={tab === 'active' ? 'active' : ''} onClick={() => pickTab('active')}>
          <Target size={15} /> {t('In Arbeit')} {saved.active.length > 0 && <span className="count">{saved.active.length}</span>}
        </button>
      </div>
      {tab !== 'search' ? (
        <div className="bld-cols">
          <aside className="bld-side">
            <SavedList tab={tab} selectedId={savedId} onSelect={setSavedId} items={items} />
          </aside>
          {savedId ? <BuildDetail id={savedId} onOpenBuild={setSavedId} items={items} /> : <div className="bld-detail" />}
        </div>
      ) : (
      <>
      <div className="toolbar bld-toolbar">
        <ItemSearch items={items} onPick={pick} />
        {gear.length > 0 && item && (
          <button className={`btn ${showGear ? 'btn-primary' : ''}`} onClick={() => setShowGear((s) => !s)}>
            <Backpack size={15} /> {t('Meine Ausrüstung')}
          </button>
        )}
        <div className="toolbar-right">
          <button className="bld-source muted small" onClick={() => openExternal(OVERFRAME)} title="overframe.gg">
            {t('Daten von overframe.gg')} <ExternalLink size={12} />
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="bld-recent">
          <span className="muted small">
            <History size={14} /> {t('Zuletzt angesehen')}
          </span>
          <Chips names={recent} byName={byName} onPick={pick} active={item} />
        </div>
      )}
      {dbError && <p className="err">{dbError}</p>}

      {(!item || showGear) &&
        (gear.length ? (
          <MyGear gear={gear} onPick={pick} />
        ) : (
          !item && (
            <div className="empty">
              <Wrench size={30} />
              <h2>{t('Builds von Overframe')}</h2>
              <p>{t('Such oben nach einem Warframe, einer Waffe oder einem Begleiter. Nach einem Sync mit dem Spiel siehst du hier auch deine eigene Ausrüstung.')}</p>
            </div>
          )
        ))}

      {item && !showGear && (
        <div className="bld-cols">
          <aside className="bld-side">
            <div className="bld-item">
              <ItemIcon src={current?.image} size={56} />
              <div>
                <h2>{item}</h2>
                {current && <small className="muted">{t(current.category)}</small>}
              </div>
              <div className="seg seg-text bld-sort" title={t('Sortierung')}>
                <button className={sort === 'score' ? 'active' : ''} onClick={() => setSort('score')}>
                  <ThumbsUp size={13} /> {t('Stimmen')}
                </button>
                <button className={sort === 'date' ? 'active' : ''} onClick={() => setSort('date')}>
                  <ArrowDownUp size={13} /> {t('Neueste')}
                </button>
              </div>
            </div>
            <BuildList itemName={item} sort={sort} selectedId={buildId} onSelect={setBuildId} />
          </aside>
          {buildId ? <BuildDetail id={buildId} onOpenBuild={setBuildId} items={items} /> : <div className="bld-detail" />}
        </div>
      )}
      </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { ChevronsUp, ListX, Search, RefreshCw, Lock, Check, BookOpen, Coins, Star, ListChecks, Flame } from 'lucide-react';
import { useTodo, removeTodo } from '../lib/todo.js';
import TodoStar from '../components/TodoStar.jsx';
import { openExternal } from '../lib/api.js';
import { useGameData } from '../lib/GameData.jsx';
import { useMasteryDb, wikiFor } from '../lib/masteryDb.js';
import { evaluate } from '../lib/evaluate.js';
import { useSettings, isFounders } from '../lib/settings.js';
import { compact } from '../lib/format.js';
import ItemDetails from '../components/ItemDetails.jsx';
import TodoRelics from '../components/TodoRelics.jsx';
import MasteryRoadmap from '../components/MasteryRoadmap.jsx';
import { Route } from 'lucide-react';
import { useT } from '../lib/i18n.js';

const PAGE = 48;

const STATUS = {
  all: 'Alle fehlenden',
  missing: 'Teile fehlen',
  blueprints: 'Blaupausen komplett',
  buildable: 'Baubar',
  leveling: 'Im Besitz – leveln',
};

function Overview({ rows, inv }) {
  const t = useT();
  const cats = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const c = m.get(r.item.category) ?? { total: 0, mastered: 0, leveling: 0 };
      c.total++;
      if (r.status === 'mastered') c.mastered++;
      if (r.status === 'leveling') c.leveling++;
      m.set(r.item.category, c);
    }
    return [...m.entries()];
  }, [rows]);
  const total = rows.length;
  const mastered = rows.filter((r) => r.status === 'mastered').length;
  const buildable = rows.filter((r) => r.status === 'buildable').length;
  const blueprints = rows.filter((r) => r.status === 'blueprints').length;

  return (
    <div className="overview">
      <div className="mr-head">
        <span className="mr-big">{inv?.player.mr ?? '–'}</span>
        <div className="mr-bar-wrap">
          <div className="mr-bar-label">
            <span>{t('{p} % gemeistert', { p: Math.round((mastered / Math.max(1, total)) * 100) })}</span>
            <span>
              {mastered} / {total} Items
            </span>
          </div>
          <div className="bar">
            <i style={{ width: `${(mastered / Math.max(1, total)) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="cat-grid">
        {cats.map(([name, c]) => (
          <div key={name} className="cat-card">
            <div className="cat-title">
              <b>{t(name)}</b>
              <span className="accent">{Math.round((c.mastered / c.total) * 100)} %</span>
            </div>
            <div className="bar small">
              <i style={{ width: `${(c.mastered / c.total) * 100}%` }} />
            </div>
            <div className="muted small">
              {t('{a}/{b} gemeistert · {c} in Arbeit', { a: c.mastered, b: c.total, c: c.leveling })}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">
        {t(
          '{a} Items kannst du sofort bauen (Teile, Rohstoffe und Credits vorhanden). Bei {b} weiteren hast du alle Blaupausen, es fehlen aber noch Rohstoffe oder gebaute Bauteile.',
          { a: buildable, b: blueprints },
        )}
      </p>
    </div>
  );
}

/** Wiki-Seite, auf der steht, wo man ein Bauteil farmt. */
function partWiki(part, item) {
  // Bauteil ist selbst eine Waffe/ein Warframe (z. B. Bronco Prime für Akbronco Prime)
  if (!part.id.includes('/Recipes/')) return wikiFor(part.name);
  return item.wiki ? `${item.wiki}#Acquisition` : wikiFor(item.name);
}

function PartChip({ part, item, onOpen }) {
  const t = useT();
  const ok = part.built >= part.count;
  const bpOnly = !ok && part.built + part.bp >= part.count;
  const drop = part.drops[0];
  const title = part.drops.length
    ? part.drops.map((d) => `${d.location}${d.chance != null ? ` – ${d.chance}%` : ''}`).join('\n')
    : t('Kein Drop bekannt (Markt, Clan-Dojo oder Händler)');
  return (
    <li className={`part ${ok ? 'ok' : bpOnly ? 'bp' : ''}`} title={title} onClick={onOpen}>
      <span className="part-name">
        {ok && <Check size={12} />} {part.name}
      </span>
      <span className="part-count">
        {Math.min(part.built + part.bp, part.count)}/{part.count}
        {bpOnly && ' BP'}
      </span>
      <button
        className="part-wiki"
        onClick={(e) => {
          e.stopPropagation();
          openExternal(partWiki(part, item));
        }}
        title={t('Im Wiki nachsehen, wie man es farmt')}
      >
        <BookOpen size={13} /> Wiki
      </button>
      {!ok && !bpOnly && drop && <span className="part-drop">{drop.location}</span>}
      {bpOnly && <span className="part-drop">{t('Blaupause vorhanden – Bauteil muss noch gebaut werden')}</span>}
    </li>
  );
}

function MissingCard({ row, onOpen }) {
  const t = useT();
  const { item, status, rank, parts, resources, creditsOk } = row;
  const missingRes = resources.filter((r) => r.built < r.count);
  return (
    <article className={`mastery-card status-${status}`} onClick={() => onOpen()}>
      <div className="mastery-head">
        <div className="item-img sm">{item.image && <img src={item.image} alt="" loading="lazy" />}</div>
        <div className="mastery-title">
          <span className="item-name">{item.name}</span>
          <div className="mastery-tags">
            <span className="tag">{t(item.category)}</span>
            {item.masteryReq > 0 && <span className="tag">MR {item.masteryReq}</span>}
            {item.vaulted && (
              <span className="tag tag-vault">
                <Lock size={11} /> Vaulted
              </span>
            )}
          </div>
        </div>
        <div className="mastery-side">
          <span className={`status-chip ${status}`}>
            {status === 'mastered' && t('Gemeistert')}
            {status === 'leveling' && t('Rang {a}/{b}', { a: rank, b: item.maxRank })}
            {status === 'buildable' && t('Baubar')}
            {status === 'blueprints' && t('Blaupausen da')}
            {status === 'missing' && t('Fehlt')}
          </span>
          <TodoStar id={item.id} />
        </div>
      </div>
      {status !== 'leveling' && status !== 'mastered' && (
        <>
          {parts.length ? (
            <ul className="parts">
              {parts.map((p) => (
                <PartChip key={p.id} part={p} item={item} onOpen={(e) => (e.stopPropagation(), onOpen(p.id))} />
              ))}
            </ul>
          ) : (
            <p className="muted small">{t('Keine Blaupause bekannt – Markt, Dojo, Händler oder Quest.')}</p>
          )}
          {(missingRes.length > 0 || !creditsOk) && (
            <div className="res-missing">
              <span className="muted">{t('Es fehlen:')}</span>
              {!creditsOk && (
                <span className="res-chip">
                  <Coins size={12} /> {compact(item.credits)} Credits
                </span>
              )}
              {missingRes.map((r) => (
                <span key={r.id} className="res-chip" title={t('{a} von {b}', { a: r.built, b: r.count })}>
                  {r.name} {compact(r.built)}/{compact(r.count)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function Missing({ rows, onOpen }) {
  const t = useT();
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => setLimit(PAGE), [status, category, query]);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.item.category))], [rows]);
  const open = rows.filter((r) => r.status !== 'mastered');
  const counts = Object.fromEntries(
    Object.keys(STATUS).map((id) => [id, id === 'all' ? open.length : open.filter((r) => r.status === id).length]),
  );

  const q = query.trim().toLowerCase();
  const shown = open
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => category === 'all' || r.item.category === category)
    .filter((r) => !q || r.item.name.toLowerCase().includes(q));

  return (
    <>
      <div className="toolbar">
        <div className="seg seg-text">
          {Object.entries(STATUS).map(([id, label]) => (
            <button key={id} className={status === id ? 'active' : ''} onClick={() => setStatus(id)}>
              {t(label)} <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="select">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">{t('Alle Kategorien')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Suchen')} />
          </label>
        </div>
      </div>
      <div className="card-grid three">
        {shown.slice(0, limit).map((r) => (
          <MissingCard key={r.item.id} row={r} onOpen={(partId) => onOpen(r.item, partId)} />
        ))}
      </div>
      {shown.length > limit && (
        <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          {t('Mehr anzeigen ({n} weitere)', { n: shown.length - limit })}
        </button>
      )}
      {shown.length === 0 && <div className="empty">{t('Nichts offen in dieser Ansicht. 🎉')}</div>}
    </>
  );
}

/** Sammelliste: was für alle To-Do-Items noch fehlt (Teile mit Fundort, Rohstoffe summiert). */
function FarmList({ rows, inv, onOpen }) {
  const t = useT();
  const open = rows.filter((r) => r.status !== 'mastered' && r.status !== 'leveling');
  const parts = open.flatMap((r) =>
    r.parts.filter((p) => p.built + p.bp < p.count).map((p) => ({ ...p, item: r.item })),
  );
  const toBuild = open.flatMap((r) =>
    r.parts.filter((p) => p.built < p.count && p.built + p.bp >= p.count).map((p) => ({ ...p, item: r.item })),
  );
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
  const missingRes = [...resources.values()].filter((r) => r.built < r.need);
  const haveCredits = inv?.player.credits ?? 0;

  if (!parts.length && !toBuild.length && !missingRes.length && haveCredits >= credits) {
    return <p className="notice ok-notice">{t('Für deine To-Do-Items fehlt nichts mehr – ab in die Foundry! 🎉')}</p>;
  }

  return (
    <section className="farm-list">
      <h3>{t('Noch zu farmen')}</h3>
      <div className="farm-cols">
        <div>
          <h4>{t('Bauteile & Blaupausen ({n})', { n: parts.length })}</h4>
          <ul>
            {parts.map((p) => (
              <li key={`${p.item.id}|${p.id}`} onClick={() => onOpen(p.item, p.id)}>
                <span className="farm-name">
                  <b>{p.item.name}</b> {p.name}
                  {p.count > 1 && ` (${p.built + p.bp}/${p.count})`}
                </span>
                <span className="farm-where">{p.drops[0]?.location ?? t('Markt / Dojo / Händler')}</span>
                <button
                  className="part-wiki"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternal(partWiki(p, p.item));
                  }}
                >
                  <BookOpen size={13} /> Wiki
                </button>
              </li>
            ))}
            {parts.length === 0 && <li className="muted">{t('Alle Blaupausen und Teile vorhanden.')}</li>}
          </ul>
          {toBuild.length > 0 && (
            <>
              <h4>{t('Noch in der Foundry bauen ({n})', { n: toBuild.length })}</h4>
              <ul>
                {toBuild.map((p) => (
                  <li key={`${p.item.id}|${p.id}`} onClick={() => onOpen(p.item, p.id)}>
                    <span className="farm-name">
                      <b>{p.item.name}</b> {p.name}
                    </span>
                    <span className="farm-where">{t('Blaupause vorhanden')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4>{t('Rohstoffe & Credits')}</h4>
          <ul className="res-list">
            <li className={haveCredits >= credits ? 'ok' : 'bad'}>
              <Coins size={14} /> Credits
              <span>
                {compact(haveCredits)}/{compact(credits)}
              </span>
            </li>
            {[...resources.values()].map((r) => (
              <li key={r.id} className={r.built >= r.need ? 'ok' : 'bad'}>
                {r.image && <img src={r.image} alt="" />} {r.name}
                <span>
                  {compact(r.built)}/{compact(r.need)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Todo({ rows, todo, inv, onOpen }) {
  const t = useT();
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  const list = todo.map((id) => byId.get(id)).filter(Boolean);
  const done = list.filter((r) => r.status === 'mastered');
  const [sub, setSub] = useState('list'); // 'list' | 'relics'

  const subTabs = (
    <div className="sub-tabs">
      <button className={sub === 'list' ? 'active' : ''} onClick={() => setSub('list')}>
        <ListChecks size={15} /> {t('Übersicht')}
      </button>
      <button className={sub === 'relics' ? 'active' : ''} onClick={() => setSub('relics')}>
        <Flame size={15} /> {t('Relikte')}
      </button>
    </div>
  );
  if (!list.length && sub === 'list') {
    return (
      <>
        {subTabs}
        <div className="empty">
          <Star size={32} className="accent" />
          <h2>{t('Deine To-Do-Liste ist leer')}</h2>
          <p>{t('Klick im Tab „Fehlt“ oder im Details-Fenster auf den ☆, um ein Item hinzuzufügen.')}</p>
        </div>
      </>
    );
  }

  if (sub === 'relics') {
    return (
      <>
        {subTabs}
        <TodoRelics rows={list} inv={inv} onOpen={onOpen} />
      </>
    );
  }

  return (
    <>
      {subTabs}
      <FarmList rows={list} inv={inv} onOpen={onOpen} />
      <div className="todo-head">
        <h3>
          {t('Meine Items')} <span className="count">{list.length}</span>
        </h3>
        {done.length > 0 && (
          <button className="btn" onClick={() => done.forEach((r) => removeTodo(r.item.id))}>
            <Check size={15} /> {t('{n} gemeisterte entfernen', { n: done.length })}
          </button>
        )}
      </div>
      <div className="card-grid three">
        {list.map((r) => (
          <MissingCard key={r.item.id} row={r} onOpen={(partId) => onOpen(r.item, partId)} />
        ))}
      </div>
    </>
  );
}

export default function Mastery() {
  const t = useT();
  const { inventory, sync, syncing } = useGameData();
  const { db, error } = useMasteryDb();
  const [tab, setTab] = useState('missing');
  const [details, setDetails] = useState(null);
  const todo = useTodo();

  const { hideFounders } = useSettings();
  const rows = useMemo(
    () =>
      db
        ? db.items
            .map((i) => evaluate(i, inventory))
            // Founders-Items (nicht mehr erhältlich) auf Wunsch weglassen – außer man hat sie
            .filter((r) => !hideFounders || !isFounders(r.item) || r.owned || r.xp > 0)
        : [],
    [db, inventory, hideFounders],
  );

  if (error) return <div className="empty">{t('Item-Datenbank nicht ladbar: {e}', { e: error })}</div>;
  if (!db) return <div className="empty">{t('Lade Item-Datenbank (WFCD) … beim ersten Mal ein paar Sekunden.')}</div>;

  return (
    <div className="page">
      <div className="page-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          <ChevronsUp size={16} /> {t('Übersicht')}
        </button>
        <button className={tab === 'missing' ? 'active' : ''} onClick={() => setTab('missing')}>
          <ListX size={16} /> {t('Fehlt')}
        </button>
        <button className={tab === 'roadmap' ? 'active' : ''} onClick={() => setTab('roadmap')}>
          <Route size={16} /> {t('Fahrplan')}
        </button>
        <button className={tab === 'todo' ? 'active' : ''} onClick={() => setTab('todo')}>
          <Star size={16} /> To-Do {todo.length > 0 && <span className="count">{todo.length}</span>}
        </button>
        {!inventory && (
          <button className="btn btn-primary push-right" onClick={sync} disabled={syncing}>
            <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {t('Mit Spiel synchronisieren')}
          </button>
        )}
      </div>
      {!inventory && <p className="notice">{t('Noch keine Spieldaten – ohne Sync wird alles als „fehlt“ angezeigt.')}</p>}
      {tab === 'overview' && <Overview rows={rows} inv={inventory} />}
      {tab === 'missing' && <Missing rows={rows} onOpen={(item, partId) => setDetails({ item, partId })} />}
      {tab === 'roadmap' && (
        <MasteryRoadmap rows={rows} inv={inventory} onOpen={(item) => setDetails({ item, partId: null })} />
      )}
      {tab === 'todo' && (
        <Todo rows={rows} todo={todo} inv={inventory} onOpen={(item, partId) => setDetails({ item, partId })} />
      )}
      {details && <ItemDetails item={details.item} partId={details.partId} onClose={() => setDetails(null)} />}
    </div>
  );
}

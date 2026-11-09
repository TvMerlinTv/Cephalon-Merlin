import { useEffect, useMemo, useState } from 'react';
import { Coins, HandCoins, Search, ArrowDownUp, Copy, Check, Infinity as All, Gem, Package, Puzzle, Sparkles, RefreshCw, Bell } from 'lucide-react';
import { getItems, getBulkPrices, getPrice, getCachedPrice, getWorldState, load, save } from '../lib/api.js';
import PriceAlerts from './PriceAlerts.jsx';
import { useAlerts } from '../lib/priceAlerts.js';
import { useGameData } from '../lib/GameData.jsx';
import { useMasteryDb } from '../lib/masteryDb.js';
import { spareParts, spareSets, wtsMessages, copyToClipboard, CHAT_LIMIT } from '../lib/trade.js';
import { countdown } from '../lib/format.js';
import { useNow } from '../lib/useNow.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import { useT } from '../lib/i18n.js';
import './trade.css';

const TAB_KEY = 'td.trade.tab';
const KEEP_KEY = 'td.trade.keep.v1';

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

// Gemeinsame Daten beider Reiter: übrige Prime-Teile mit warframe.market-Item und Ø-Preis
function useTradeData() {
  const { inventory } = useGameData();
  const { db, error } = useMasteryDb();
  const [market, setMarket] = useState(null);
  const [bulk, setBulk] = useState({});
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    getItems()
      .then((items) => setMarket({ items, byRef: new Map(items.filter((i) => i.gameRef).map((i) => [i.gameRef, i])) }))
      .catch((e) => setLoadError(e.message));
    getBulkPrices().then(setBulk).catch(() => {});
  }, []);

  const parts = useMemo(() => {
    if (!db || !inventory) return [];
    return spareParts(db, inventory).map((e) => {
      const m = market?.byRef.get(e.id) ?? market?.byRef.get(e.id.replace(/Component$/, 'Blueprint')) ?? null;
      const name = m?.name ?? `${e.items[0].name} ${e.part.name}`;
      const plat = bulk[name.toLowerCase()] || null;
      return { ...e, m, name, plat, image: m?.thumb ?? e.part.image };
    });
  }, [db, inventory, market, bulk]);

  return { inventory, db, market, bulk, parts, error: error ?? loadError };
}

export default function Trade() {
  const t = useT();
  const [tab, setTab] = useState(() => load(TAB_KEY, 'ducats'));
  const data = useTradeData();
  const alerts = useAlerts();
  const pick = (id) => {
    setTab(id);
    save(TAB_KEY, id);
  };

  let body;
  if (tab === 'alerts') body = <PriceAlerts />; // braucht kein Inventar
  else if (data.error) body = <div className="empty">{data.error}</div>;
  else if (!data.inventory) body = <div className="empty">{t('Noch kein Inventar – synchronisiere zuerst mit dem Spiel.')}</div>;
  else if (!data.db || !data.market) body = <div className="empty">{t('Lade Daten …')}</div>;
  else body = tab === 'ducats' ? <DucatTab data={data} /> : <SellTab data={data} />;

  return (
    <div className="page">
      <div className="page-tabs">
        <button className={tab === 'ducats' ? 'active' : ''} onClick={() => pick('ducats')}>
          <Coins size={16} /> {t('Ducats für Baro')}
        </button>
        <button className={tab === 'sell' ? 'active' : ''} onClick={() => pick('sell')}>
          <HandCoins size={16} /> {t('Verkaufen')}
        </button>
        <button className={tab === 'alerts' ? 'active' : ''} onClick={() => pick('alerts')}>
          <Bell size={16} /> {t('Preis-Alarme')}
          {alerts.length > 0 && <span className="count">{alerts.length}</span>}
        </button>
      </div>
      {body}
    </div>
  );
}

// ---------- Reiter 1: Ducat-Rechner ----------
function BaroInfo() {
  const t = useT();
  const now = useNow();
  const [baro, setBaro] = useState(null);
  useEffect(() => {
    getWorldState()
      .then((w) => setBaro(w.baro ?? null))
      .catch(() => {});
  }, []);
  if (!baro) return null;
  const here = new Date(baro.activation).getTime() <= now;
  return (
    <span className="trd-baro">
      {here
        ? t('Baro ist da ({place}) – geht in {t}', { place: baro.location ?? '', t: countdown(baro.expiry, now) })
        : t('Baro kommt in {t}', { t: countdown(baro.activation, now) })}
    </span>
  );
}

function DucatTab({ data }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () =>
      data.parts
        .map((p) => ({ ...p, ratio: p.plat ? p.ducats / p.plat : null }))
        // viele Ducats pro Platin zuerst; ohne Preis ans Ende
        .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.ducats - a.ducats || a.name.localeCompare(b.name)),
    [data.parts],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const total = rows.reduce((s, r) => s + r.ducats * r.spare, 0);
  const totalPlat = rows.reduce((s, r) => s + (r.plat ?? 0) * r.spare, 0);

  return (
    <>
      <div className="toolbar">
        <BaroInfo />
        <div className="toolbar-right">
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Suchen')} />
          </label>
        </div>
      </div>
      <p className="muted small trd-hint">
        {t('Nur Prime-Teile, die kein noch nicht gebautes Item mehr braucht (gemeistert oder schon gebaut). Gebaute Warframe-Bauteile zählen nicht – Baro nimmt nur Blaupausen.')}
      </p>
      {rows.length === 0 ? (
        <div className="empty">{t('Keine übrigen Prime-Teile gefunden.')}</div>
      ) : (
        <div className="trd-table-wrap">
          <table className="trd-table">
            <thead>
              <tr>
                <th>{t('Teil')}</th>
                <th className="num">{t('Übrig')}</th>
                <th className="num">Ducats</th>
                <th className="num">{t('Ø Platin')}</th>
                <th className="num" title={t('Ducats pro Platin Marktwert')}>
                  {t('Ducats/Platin')}
                </th>
                <th className="num">{t('Summe')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.ratio != null && r.ratio >= 10 ? 'trd-good' : ''}>
                  <td>
                    <span className="trd-name">
                      {r.image && <img src={r.image} alt="" loading="lazy" />}
                      {r.name}
                    </span>
                  </td>
                  <td className="num">{r.spare}</td>
                  <td className="num">
                    {r.ducats} <Ducat size={12} />
                  </td>
                  <td className="num">
                    {r.plat != null ? (
                      <>
                        {r.plat.toFixed(1)} <Plat size={12} />
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num">{r.ratio != null ? r.ratio.toFixed(1) : '–'}</td>
                  <td className="num">
                    {fmt(r.ducats * r.spare)} <Ducat size={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="totals">
        <span title={t('Übrige Teile')}>{rows.reduce((s, r) => s + r.spare, 0)}×</span>
        <span title={t('Ducats zum Opfern')}>
          {fmt(total)} <Ducat />
        </span>
        <span title={t('Marktwert (Durchschnitt)')}>
          {fmt(totalPlat)} <Plat />
        </span>
      </div>
    </>
  );
}

// ---------- Reiter 2: Verkaufs-Helfer ----------
const KINDS = [
  { id: 'all', label: 'Alle', icon: All },
  { id: 'part', label: 'Prime-Teile', icon: Gem },
  { id: 'set', label: 'Sets', icon: Package },
  { id: 'mod', label: 'Mods', icon: Puzzle },
  { id: 'arcane', label: 'Arcanes', icon: Sparkles },
];
const SORTS = {
  value: { label: 'Gesamtwert', fn: (a, b) => (b.price ?? -1) * b.qty - (a.price ?? -1) * a.qty },
  price: { label: 'Preis', fn: (a, b) => (b.price ?? -1) - (a.price ?? -1) },
  name: { label: 'Name', fn: (a, b) => a.name.localeCompare(b.name) },
};

function SellTab({ data }) {
  const t = useT();
  const { inventory, db, market, bulk, parts } = data;
  const [keep, setKeep] = useState(() => load(KEEP_KEY, 1));
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('value');
  const [selected, setSelected] = useState(() => new Set());
  const [edits, setEdits] = useState({});
  const [msgs, setMsgs] = useState(null);
  const [copied, setCopied] = useState(null);
  const [priceTick, setPriceTick] = useState(0);
  const [loading, setLoading] = useState(null); // { done, total }
  const [sortTick, setSortTick] = useState(0);

  // Sets zuerst aus den übrigen Teilen bilden, der Rest wird einzeln verkauft
  const base = useMemo(() => {
    const spare = new Map(parts.map((p) => [p.id, p.spare]));
    const out = [];
    for (const { item, count } of spareSets(db, spare)) {
      const m = market.byRef.get(item.id);
      if (!m) continue;
      out.push({ key: m.slug, kind: 'set', name: m.name, slug: m.slug, image: m.thumb, qty: count, avg: bulk[m.name.toLowerCase()] || null });
    }
    for (const p of parts) {
      const qty = spare.get(p.id);
      if (!p.m || qty < 1) continue;
      out.push({ key: p.m.slug, kind: 'part', name: p.name, slug: p.m.slug, image: p.image, qty, avg: p.plat });
    }
    for (const m of market.items) {
      const isMod = m.tags.includes('mod');
      const isArcane = m.tags.includes('arcane_enhancement');
      if ((!isMod && !isArcane) || !m.gameRef) continue;
      const qty = (inventory.counts[m.gameRef] ?? 0) - keep;
      if (qty > 0) out.push({ key: m.slug, kind: isMod ? 'mod' : 'arcane', name: m.name, slug: m.slug, image: m.thumb, qty, avg: null });
    }
    return out;
  }, [parts, db, market, bulk, inventory, keep]);

  // Mods/Arcanes haben keinen Sammelpreis: nacheinander von warframe.market holen (gedrosselt, 15 Min. gecacht)
  useEffect(() => {
    let alive = true;
    const todo = base.filter((r) => r.avg == null && !getCachedPrice(r.slug));
    if (!todo.length) return;
    (async () => {
      setLoading({ done: 0, total: todo.length });
      for (let i = 0; i < todo.length && alive; i++) {
        await getPrice(todo[i].slug).catch(() => {});
        if (!alive) return;
        setLoading({ done: i + 1, total: todo.length });
        if (i % 5 === 4 || i === todo.length - 1) setPriceTick((n) => n + 1);
      }
      if (alive) {
        setLoading(null);
        setSortTick((n) => n + 1);
      }
    })();
    return () => {
      alive = false;
      setLoading(null);
    };
  }, [base]);

  const rows = useMemo(
    () =>
      base.map((r) => {
        const mkt = r.avg ?? getCachedPrice(r.slug)?.wts ?? null;
        const price = edits[r.key] ?? (mkt != null ? Math.max(1, Math.round(mkt)) : null);
        return { ...r, market: mkt, price };
      }),
    [base, edits, priceTick],
  );

  // Reihenfolge erst neu bilden, wenn alle Preise da sind (oder die Sortierung wechselt) –
  // sonst springen die Zeilen beim Nachladen und beim Tippen eines eigenen Preises
  const order = useMemo(() => new Map([...rows].sort(SORTS[sort].fn).map((r, i) => [r.key, i])), [base, sort, sortTick]);
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => kind === 'all' || r.kind === kind)
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => order.get(a.key) - order.get(b.key));

  const toggle = (key) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.key));
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const r of shown) allShown ? next.delete(r.key) : next.add(r.key);
      return next;
    });

  const chosen = rows.filter((r) => selected.has(r.key) && r.price != null).sort(SORTS.price.fn);
  const sum = chosen.reduce((s, r) => s + r.price * r.qty, 0);

  const copy = async (text, i) => {
    try {
      await copyToClipboard(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      /* Zwischenablage nicht verfügbar */
    }
  };
  const makeWts = () => {
    const list = wtsMessages(chosen);
    setMsgs(list);
    if (list.length) copy(list[0], 0);
  };

  return (
    <>
      <div className="toolbar">
        <div className="filter-pills">
          {KINDS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)} title={t(label)}>
              <Icon size={16} />
              {kind === id && <span>{t(label)}</span>}
            </button>
          ))}
        </div>
        {loading && (
          <span className="muted small trd-loading">
            <RefreshCw size={13} className="spin" /> {t('Preise {a}/{b}', { a: loading.done, b: loading.total })}
          </span>
        )}
        <div className="toolbar-right">
          <label className="trd-keep" title={t('So viele Exemplare jeder Mod/jedes Arcanes behältst du')}>
            {t('Behalten')}
            <input
              type="number"
              min="0"
              max="99"
              value={keep}
              onChange={(e) => {
                const v = Math.max(0, Math.min(99, Number(e.target.value) || 0));
                setKeep(v);
                save(KEEP_KEY, v);
              }}
            />
          </label>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Suchen')} />
          </label>
          <label className="select">
            <ArrowDownUp size={15} />
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([id, s]) => (
                <option key={id} value={id}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">{t('Nichts zum Verkaufen gefunden.')}</div>
      ) : (
        <div className="trd-table-wrap">
          <table className="trd-table trd-sell">
            <thead>
              <tr>
                <th className="chk">
                  <input type="checkbox" checked={allShown} onChange={toggleAll} title={t('Alle auswählen')} />
                </th>
                <th>Item</th>
                <th className="num">{t('Menge')}</th>
                <th className="num">{t('Marktpreis')}</th>
                <th className="num">{t('Dein Preis')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={selected.has(r.key) ? 'sel' : ''} onClick={() => toggle(r.key)}>
                  <td className="chk">
                    <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td>
                    <span className="trd-name">
                      {r.image && <img src={r.image} alt="" loading="lazy" />}
                      {r.name}
                      {r.kind === 'set' && <small className="trd-tag">Set</small>}
                    </span>
                  </td>
                  <td className="num">{r.qty}</td>
                  <td className="num">
                    {r.market != null ? (
                      <>
                        {r.avg != null ? r.market.toFixed(1) : r.market} <Plat size={12} />
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="trd-price"
                      type="number"
                      min="1"
                      value={r.price ?? ''}
                      placeholder="–"
                      onChange={(e) => {
                        const v = Math.max(1, Math.round(Number(e.target.value) || 0));
                        setEdits((x) => ({ ...x, [r.key]: v }));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msgs && (
        <div className="trd-msgs">
          {msgs.length > 1 && <p className="muted small">{t('Zu lang für eine Chat-Zeile – aufgeteilt in {n} Nachrichten:', { n: msgs.length })}</p>}
          {msgs.map((m, i) => (
            <div key={i} className="trd-msg">
              <code>{m}</code>
              <small className="muted">
                {m.length}/{CHAT_LIMIT}
              </small>
              <button className="btn" onClick={() => copy(m, i)} title={t('Kopieren')}>
                {copied === i ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="totals trd-sellbar">
        <span>{t('{n} ausgewählt', { n: chosen.length })}</span>
        <span>
          {fmt(sum)} <Plat />
        </span>
        <button className="btn btn-primary" disabled={!chosen.length} onClick={makeWts}>
          <Copy size={14} /> {t('WTS-Nachricht kopieren')}
        </button>
      </div>
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Infinity as All, Gem, Puzzle, Flame, Sparkles, Box, Search, ArrowDownUp, RefreshCw, FileUp } from 'lucide-react';
import { getItems, getCachedPrice, isElectron } from '../lib/api.js';
import { useGameData } from '../lib/GameData.jsx';
import ItemCard from '../components/ItemCard.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import { loadMasteryDb, useMasteryDb } from '../lib/masteryDb.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import { useT } from '../lib/i18n.js';

// Früher gab es manuelle Mengen-Korrekturen; die alten Werte werden einmal gelöscht
try {
  localStorage.removeItem('td.inventory.manual.v1');
} catch {
  /* kein Speicher */
}
const PAGE = 60;

const FILTERS = [
  { id: 'all', label: 'Alle', icon: All, test: () => true },
  { id: 'prime', label: 'Prime-Teile', icon: Gem, test: (t) => t.includes('prime') && !t.includes('set') && !t.includes('mod') },
  { id: 'mod', label: 'Mods', icon: Puzzle, test: (t) => t.includes('mod') },
  { id: 'relic', label: 'Relikte', icon: Flame, test: (t) => t.includes('relic') },
  { id: 'arcane', label: 'Arcanes', icon: Sparkles, test: (t) => t.includes('arcane_enhancement') },
  {
    id: 'misc', label: 'Sonstiges', icon: Box,
    test: (t) => !['prime', 'mod', 'relic', 'arcane_enhancement'].some((x) => t.includes(x)),
  },
];

const SORTS = {
  name: { label: 'Name', fn: (a, b) => a.item.name.localeCompare(b.item.name) },
  wts: { label: 'Preis (WTS)', fn: (a, b) => (b.price?.wts ?? -1) - (a.price?.wts ?? -1) },
  total: { label: 'Gesamtwert', fn: (a, b) => (b.price?.wts ?? 0) * b.qty - (a.price?.wts ?? 0) * a.qty },
  ducats: { label: 'Ducats', fn: (a, b) => (b.item.ducats ?? -1) - (a.item.ducats ?? -1) },
  qty: { label: 'Menge', fn: (a, b) => b.qty - a.qty },
};

export default function Inventory() {
  const t = useT();
  const { inventory, syncing, sync, importFile, error } = useGameData();
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [limit, setLimit] = useState(PAGE);
  const [priceTick, setPriceTick] = useState(0);
  const [details, setDetails] = useState(null);
  const { db } = useMasteryDb();

  // Prime-Teile & Co. öffnen die Bauplan-Ansicht ihres Items, Mods/Relikte die Markt-Ansicht.
  const openDetails = async (marketItem, qty) => {
    const db = await loadMasteryDb().catch(() => null);
    const entry = marketItem.gameRef ? db?.index.get(marketItem.gameRef) : null;
    setDetails({ entry, marketItem, qty });
  };

  useEffect(() => {
    getItems().then(setItems).catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => setLimit(PAGE), [filter, query, sort]);

  // Teile: großes Bild = Waffe/Frame, kleines Teil-Symbol (Lauf, Gehäuse, Blaupause …) im Kreis aus der Item-Datenbank
  const artFor = (item) => {
    const e = item.gameRef && db?.index.get(item.gameRef);
    if (!e?.part?.image || e.part.image === e.item.image) return {};
    return { image: e.item.image ?? item.thumb, badge: e.part.image, subtitle: `${t('Teil')} · ${e.item.name}` };
  };

  // Mengen kommen nur aus dem Sync mit dem Spiel – von Hand verstellen geht nicht (ist ja dein echtes Inventar)
  const rows = useMemo(() => {
    if (!items) return [];
    const out = [];
    for (const item of items) {
      if (item.tags.includes('set')) continue;
      const qty = (item.gameRef && inventory?.counts[item.gameRef]) || 0;
      if (qty > 0) out.push({ item, qty, price: getCachedPrice(item.slug) });
    }
    return out;
  }, [items, inventory]);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter);
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => f.test(r.item.tags))
      .filter((r) => !q || r.item.name.toLowerCase().includes(q))
      .map((r) => ({ ...r, price: getCachedPrice(r.item.slug) }))
      .sort(SORTS[sort].fn);
  }, [rows, filter, query, sort, priceTick]);

  const totals = useMemo(() => {
    let plat = 0;
    let ducats = 0;
    let priced = 0;
    for (const r of shown) {
      const p = getCachedPrice(r.item.slug);
      if (p?.wts != null) {
        plat += p.wts * r.qty;
        priced++;
      }
      ducats += (r.item.ducats ?? 0) * r.qty;
    }
    return { plat, ducats, priced };
  }, [shown, priceTick]);

  const onPrice = useCallback(() => setPriceTick((t) => t + 1), []);

  if (loadError) return <div className="empty">{t('warframe.market nicht erreichbar: {e}', { e: loadError })}</div>;
  if (!items) return <div className="empty">{t('Lade Item-Liste von warframe.market …')}</div>;

  return (
    <div className="page">
      <div className="toolbar">
        <div className="filter-pills">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)} title={t(label)}>
              <Icon size={16} />
              {filter === id && <span>{t(label)}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
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

      {rows.length === 0 ? (
        <div className="empty">
          <h2>{t('Noch keine Items')}</h2>
          <p>
            {t('Starte Warframe, logge dich ein und klicke auf')} <b>{t('Mit Spiel synchronisieren')}</b>.{' '}
            {t('Cephalon Merlin liest dann dein Inventar – genau wie AlecaFrame.')}
          </p>
          {error && <p className="err">{error}</p>}
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={sync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {t('Mit Spiel synchronisieren')}
            </button>
            {isElectron && (
              <button className="btn" onClick={importFile}>
                <FileUp size={15} /> {t('inventory.json importieren')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="card-grid two">
            {shown.slice(0, limit).map((r) => (
              <ItemCard key={r.item.slug} item={r.item} qty={r.qty} {...artFor(r.item)} onPrice={onPrice} onOpen={(i) => openDetails(i, r.qty)} />
            ))}
          </div>
          {shown.length > limit && (
            <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('Mehr anzeigen ({n} weitere)', { n: shown.length - limit })}
            </button>
          )}
          {shown.length === 0 && <div className="empty">{t('Keine Treffer.')}</div>}
        </>
      )}

      <div className="totals">
        <span title={t('Preise geladen für {a} von {b} Items', { a: totals.priced, b: shown.length })}>
          {totals.plat.toLocaleString('de-DE')} <Plat />
        </span>
        <span>
          {totals.ducats.toLocaleString('de-DE')} <Ducat />
        </span>
      </div>

      {details && (
        <ItemDetails
          item={details.entry?.item}
          partId={details.entry?.part?.id}
          marketItem={details.marketItem}
          qty={details.qty}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}

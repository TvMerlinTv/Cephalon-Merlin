import { useEffect, useMemo, useState } from 'react';
import { Infinity as All, Search, ArrowDownUp, Users, Lock, Check, Sparkles } from 'lucide-react';
import { game, getItems, getBulkPrices, load, save } from '../lib/api.js';
import { useGameData, builtCount } from '../lib/GameData.jsx';
import { useMasteryDb } from '../lib/masteryDb.js';
import ItemDetails from '../components/ItemDetails.jsx';
import RelicIcon from '../components/RelicIcon.jsx';
import { expectedValue, rarityOf } from '../lib/relicMath.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import { useT } from '../lib/i18n.js';

const PAGE = 40;
const TIERS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem'];
const REFINEMENTS = [
  ['intact', 'Intact'],
  ['exceptional', 'Exceptional'],
  ['flawless', 'Flawless'],
  ['radiant', 'Radiant'],
];
const SORTS = {
  plat: 'Platin-Profit',
  ducats: 'Ducats',
  count: 'Anzahl',
  name: 'Name',
};
const PREFS_KEY = 'td.relics.prefs.v1';

function RewardIcon({ reward, meta, have, onOpen }) {
  const t = useT();
  const tip = [
    reward.name,
    t('{n} % Chance', { n: reward.chance }),
    meta.price != null ? t('{n} Platin', { n: meta.price }) : null,
    meta.ducats ? t('{n} Ducats', { n: meta.ducats }) : null,
    have ? t('Hast du schon') : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button className={`reward ${rarityOf(reward.chance)} ${have ? 'have' : ''}`} title={tip} onClick={onOpen}>
      {meta.thumb ? <img src={meta.thumb} alt="" loading="lazy" /> : <Sparkles size={16} />}
      {have && (
        <span className="reward-check">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

export default function Relics() {
  const tr = useT(); // "t" ist unten die Laufvariable der Ären
  const { inventory } = useGameData();
  const { db: mastery } = useMasteryDb();
  const [relicDb, setRelicDb] = useState(null);
  const [market, setMarket] = useState(null);
  const [prices, setPrices] = useState(null);
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(() => ({
    tier: 'all',
    sort: 'plat',
    squad: 4,
    refinement: 'intact',
    onlyOwned: true,
    ...load(PREFS_KEY, {}),
  }));
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [details, setDetails] = useState(null);

  const setPref = (k, v) =>
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      save(PREFS_KEY, next);
      return next;
    });

  useEffect(() => {
    Promise.all([game.relicDb(), getItems(), getBulkPrices()])
      .then(([r, items, bulk]) => {
        setRelicDb(r);
        setMarket(new Map(items.map((i) => [i.slug, i])));
        setPrices(bulk);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => setLimit(PAGE), [prefs, query]);

  // Preis, Ducats, Bild pro Belohnung
  const metaOf = useMemo(() => {
    const cache = new Map();
    return (r) => {
      if (cache.has(r.name)) return cache.get(r.name);
      const m = r.slug ? market?.get(r.slug) : null;
      const meta = {
        price: prices?.[r.name.toLowerCase()] ?? null,
        ducats: m?.ducats ?? 0,
        thumb: m?.thumb ?? null,
      };
      cache.set(r.name, meta);
      return meta;
    };
  }, [market, prices]);

  // Hast du das Teil schon? (im Inventar, oder das fertige Item besitzt/gemeistert)
  const haveOf = useMemo(() => {
    return (r) => {
      if (!r.id || !inventory) return false;
      if (builtCount(inventory, r.id) > 0) return true;
      const entry = mastery?.index.get(r.id);
      if (!entry) return false;
      const item = entry.item;
      return (inventory.owned[item.id] ?? 0) > 0 || (inventory.xp[item.id] ?? 0) >= item.maxXp;
    };
  }, [inventory, mastery]);

  const rows = useMemo(() => {
    if (!relicDb || !prices) return [];
    return relicDb.relics.map((relic) => {
      const owned = inventory?.relics?.[relic.id] ?? {};
      const total = Object.values(owned).reduce((a, b) => a + b, 0);
      const rewards = relic.rewards[prefs.refinement] ?? relic.rewards.intact ?? [];
      return {
        relic,
        owned,
        total,
        rewards,
        plat: expectedValue(rewards, (r) => metaOf(r).price ?? 0, prefs.squad),
        ducats: expectedValue(rewards, (r) => metaOf(r).ducats ?? 0, prefs.squad),
      };
    });
  }, [relicDb, prices, inventory, prefs.refinement, prefs.squad, metaOf]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const cmp = {
      plat: (a, b) => b.plat - a.plat,
      ducats: (a, b) => b.ducats - a.ducats,
      count: (a, b) => b.total - a.total,
      name: (a, b) => a.relic.name.localeCompare(b.relic.name),
    }[prefs.sort];
    return rows
      .filter((r) => prefs.tier === 'all' || r.relic.tier === prefs.tier)
      .filter((r) => !prefs.onlyOwned || r.total > 0)
      .filter((r) => !q || r.relic.name.toLowerCase().includes(q) || r.rewards.some((w) => w.name.toLowerCase().includes(q)))
      .sort(cmp);
  }, [rows, prefs, q]);

  const ownedTotal = rows.reduce((a, r) => a + r.total, 0);
  const ownedKinds = rows.filter((r) => r.total > 0).length;

  const openReward = (r) => {
    const entry = r.id ? mastery?.index.get(r.id) : null;
    const m = r.slug ? market?.get(r.slug) : null;
    if (entry) setDetails({ item: entry.item, partId: entry.part?.id });
    else if (m) setDetails({ marketItem: m });
  };

  if (error) return <div className="empty">{tr('Relikt-Daten nicht ladbar: {e}', { e: error })}</div>;
  if (!relicDb || !prices) return <div className="empty">{tr('Lade Relikte und Preise …')}</div>;

  return (
    <div className="page">
      <div className="toolbar">
        <div className="filter-pills">
          <button className={prefs.tier === 'all' ? 'active' : ''} onClick={() => setPref('tier', 'all')}>
            <All size={16} /> {prefs.tier === 'all' && <span>{tr('Alle')}</span>}
          </button>
          {TIERS.map((t) => (
            <button key={t} className={prefs.tier === t ? 'active' : ''} onClick={() => setPref('tier', t)} title={t}>
              <RelicIcon tier={t} size={24} />
              {prefs.tier === t && <span>{t}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Relikt oder Teil')} />
          </label>
          <label className="select">
            <ArrowDownUp size={15} />
            <select value={prefs.sort} onChange={(e) => setPref('sort', e.target.value)}>
              {Object.entries(SORTS).map(([id, label]) => (
                <option key={id} value={id}>
                  {tr(label)}
                </option>
              ))}
            </select>
          </label>
          <label className="select">
            <select value={prefs.refinement} onChange={(e) => setPref('refinement', e.target.value)} title={tr('Veredelung für die Berechnung')}>
              {REFINEMENTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="select" title={tr('Squad-Größe (Radshare)')}>
            <Users size={15} />
            <select value={prefs.squad} onChange={(e) => setPref('squad', Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card-grid relic-grid">
        {shown.slice(0, limit).map((row) => (
          <article key={row.relic.id} className="relic-card">
            <div className="relic-img">
              {row.relic.image && <img src={row.relic.image} alt="" loading="lazy" />}
              <span className="relic-count">
                {row.relic.vaulted && <Lock size={11} />} x{row.total}
              </span>
            </div>
            <div className="relic-info">
              <h3>{row.relic.name}</h3>
              <div className="relic-owned">
                {REFINEMENTS.filter(([id]) => row.owned[id]).map(([id, label]) => (
                  <span key={id}>
                    {row.owned[id]}x {label}
                  </span>
                ))}
                {row.total === 0 && <span className="muted">{tr('nicht im Besitz')}</span>}
              </div>
              <div className="relic-values">
                <span title={tr('Erwarteter Platin-Wert pro Öffnung')}>
                  <Plat /> {row.plat.toFixed(1)}
                </span>
                <span title={tr('Erwartete Ducats pro Öffnung')}>
                  <Ducat /> {row.ducats.toFixed(1)}
                </span>
              </div>
            </div>
            <div className="rewards">
              {row.rewards.map((r) => (
                <RewardIcon key={r.name} reward={r} meta={metaOf(r)} have={haveOf(r)} onOpen={() => openReward(r)} />
              ))}
            </div>
          </article>
        ))}
      </div>
      {shown.length > limit && (
        <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          {tr('Mehr anzeigen ({n} weitere)', { n: shown.length - limit })}
        </button>
      )}
      {shown.length === 0 && <div className="empty">{tr('Keine Relikte in dieser Ansicht.')}</div>}

      <div className="totals">
        <label className="check">
          <input type="checkbox" checked={prefs.onlyOwned} onChange={(e) => setPref('onlyOwned', e.target.checked)} /> {tr('Nur eigene')}
        </label>
        <span title={tr('Verschiedene Relikte / Relikte insgesamt')}>
          {tr('{a} Sorten · {b} Stück', { a: ownedKinds, b: ownedTotal })}
        </span>
      </div>

      {details && (
        <ItemDetails item={details.item} partId={details.partId} marketItem={details.marketItem} onClose={() => setDetails(null)} />
      )}
    </div>
  );
}

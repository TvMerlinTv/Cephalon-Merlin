import { useEffect, useState } from 'react';
import { Search, Copy, Check, ExternalLink, ArrowLeft } from 'lucide-react';
import { getItems, getTopOrders, openExternal, getBulkPrices, load, save } from '../lib/api.js';
import { marketItemFor } from '../lib/masteryDb.js';
import ItemPicker from '../components/ItemPicker.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import GearBrowser from '../components/GearBrowser.jsx';
import { useT } from '../lib/i18n.js';
import { Plat } from '../components/Icons.jsx';
import { takeMarketItem } from '../lib/builds.js';

const STATUS_DE = { ingame: 'Im Spiel', online: 'Online', offline: 'Offline' };

function OrderTable({ title, kind, orders, item }) {
  const [copied, setCopied] = useState(null);
  const t = useT();
  const copy = async (o) => {
    const verb = kind === 'sell' ? 'buy' : 'sell';
    const rank = item.maxRank && o.rank != null ? ` (rank ${o.rank})` : '';
    const msg = `/w ${o.user.ingameName} Hi! I want to ${verb}: "${item.name}"${rank} for ${o.platinum} platinum. (warframe.market)`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(o.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* Zwischenablage nicht verfügbar */
    }
  };
  return (
    <section className={`orders ${kind}`}>
      <h3>{title}</h3>
      {orders.length === 0 ? (
        <p className="muted">{t('Keine Angebote von Spielern, die gerade online sind.')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('Spieler')}</th>
              <th>{t('Status')}</th>
              <th>{t('Ruf')}</th>
              <th>{t('Menge')}</th>
              {item.maxRank > 0 && <th>{t('Rang')}</th>}
              <th>{t('Preis')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.user.ingameName}</td>
                <td>
                  <span className={`dot ${o.user.status}`} /> {t(STATUS_DE[o.user.status] ?? o.user.status)}
                </td>
                <td>{o.user.reputation}</td>
                <td>{o.quantity}</td>
                {item.maxRank > 0 && (
                  <td className={o.rank === item.maxRank ? 'rank-max' : 'muted'}>
                    {o.rank ?? 0}/{item.maxRank}
                  </td>
                )}
                <td className="num">
                  {o.platinum} <Plat />
                </td>
                <td>
                  <button className="icon-btn" onClick={() => copy(o)} title={t('Flüster-Nachricht kopieren')}>
                    {copied === o.id ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Market() {
  const [items, setItems] = useState([]);
  const [item, setItem] = useState(null);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(null);
  const t = useT();
  const [gearOpts, setGearOpts] = useState(null); // Set + kaufbare Teile des angeklickten Items
  const [prices, setPrices] = useState({});
  // Mods/Arcanes: welcher Rang (Max ist fast immer teurer – gemischt verfälscht es die Preise)
  const [rankMode, setRankMode] = useState(() => load('td.market.rank', 'max'));
  const pickRank = (m) => {
    setRankMode(m);
    save('td.market.rank', m);
  };

  useEffect(() => {
    getItems()
      .then((list) => {
        setItems(list);
        // Von einer anderen Seite vorgewählt (z. B. Mod aus einem Build, src/lib/builds.js)
        const slug = takeMarketItem();
        const pre = slug && list.find((i) => i.slug === slug);
        if (pre) setItem(pre);
      })
      .catch((e) => setError(e.message));
    getBulkPrices().then(setPrices).catch(() => {});
    // Seite schon offen und ein Item wird vorgewählt (z. B. Klick auf einen Preis-Alarm)
    const onPick = () =>
      getItems().then((list) => {
        const slug = takeMarketItem();
        const pre = slug && list.find((i) => i.slug === slug);
        if (!pre) return;
        setRankMode(load('td.market.rank', 'max'));
        setGearOpts(null);
        setItem(pre);
      });
    window.addEventListener('cm:market-item', onPick);
    return () => window.removeEventListener('cm:market-item', onPick);
  }, []);

  useEffect(() => {
    if (!item) return;
    setOrders(null);
    setError(null);
    const rank = item.maxRank ? (rankMode === 'max' ? item.maxRank : rankMode === '0' ? 0 : null) : null;
    getTopOrders(item.slug, rank)
      .then(setOrders)
      .catch((e) => setError(e.message));
  }, [item, rankMode]);

  // Aus der Kachel-Auswahl: das Set (bzw. das Item) auf warframe.market suchen.
  // Nicht handelbar (z. B. Ash, Ambassador)? Dann die Item-Details mit Bauplan und Fundorten.
  const byName = (name) => items.find((i) => i.name.toLowerCase() === name.toLowerCase()) ?? null;

  /** Set + alle Bauteile, die es auf warframe.market gibt (für die Leiste über den Angeboten). */
  const tradeOptions = async (gear) => {
    const opts = [];
    const set = byName(`${gear.name} Set`) ?? (await marketItemFor(gear.id)) ?? byName(gear.name);
    if (set) opts.push({ key: gear.id, label: set.name.endsWith(' Set') ? 'Set' : gear.name, image: gear.image, market: set });
    for (const part of gear.components) {
      if (part.kind !== 'part') continue;
      const m = (await marketItemFor(part.id)) ?? byName(`${gear.name} ${part.name}`);
      if (m && !opts.some((o) => o.market.slug === m.slug)) {
        opts.push({ key: part.id, label: part.name, count: part.count, image: part.image, market: m });
      }
    }
    return opts;
  };
  const pickGear = async (gear) => {
    const opts = await tradeOptions(gear);
    if (!opts.length) return setDetails({ item: gear });
    setGearOpts(opts);
    setItem(opts[0].market);
  };
  const pickPart = async (gear, part) => {
    const opts = await tradeOptions(gear);
    const hit = opts.find((o) => o.key === part.id);
    if (!hit) return setDetails({ item: gear, partId: part.id });
    setGearOpts(opts);
    setItem(hit.market);
  };

  return (
    <div className="page">
      <div className="toolbar">
        {item && (
          <button className="btn" onClick={() => setItem(null)} title={t('Zurück zur Auswahl')}>
            <ArrowLeft size={15} /> {t('Auswahl')}
          </button>
        )}
        <button className="search big as-button" onClick={() => setPicking(true)}>
          <Search size={16} /> {item ? item.name : t('Item auf warframe.market suchen …')}
        </button>
        {item?.maxRank > 0 && (
          <div className="seg seg-text" title={t('Angebote nach Mod-Rang')}>
            <button className={rankMode === 'max' ? 'active' : ''} onClick={() => pickRank('max')}>
              {t('Max (Rang {n})', { n: item.maxRank })}
            </button>
            <button className={rankMode === '0' ? 'active' : ''} onClick={() => pickRank('0')}>
              {t('Rang 0')}
            </button>
            <button className={rankMode === 'all' ? 'active' : ''} onClick={() => pickRank('all')}>
              {t('Alle')}
            </button>
          </div>
        )}
        {item && (
          <button className="btn" onClick={() => openExternal(`https://warframe.market/items/${item.slug}`)}>
            <ExternalLink size={15} /> {t('Auf warframe.market')}
          </button>
        )}
      </div>

      {error && <p className="err">{error}</p>}
      {!item && <GearBrowser onPick={pickGear} onPickPart={pickPart} />}
      {details && <ItemDetails item={details.item} partId={details.partId} onClose={() => setDetails(null)} />}
      {item && gearOpts?.length > 1 && (
        <div className="trade-opts">
          {gearOpts.map((o) => {
            const price = prices[o.market.name.toLowerCase()];
            return (
              <button
                key={o.key}
                className={`trade-opt ${o.market.slug === item.slug ? 'active' : ''}`}
                onClick={() => setItem(o.market)}
                title={o.market.name}
              >
                <span className="trade-img">{o.image && <img src={o.image} alt="" />}</span>
                <span className="trade-txt">
                  <b>
                    {o.label}
                    {o.count > 1 && ` ×${o.count}`}
                  </b>
                  {price > 0 && (
                    <small>
                      ≈ {Math.round(price)} <Plat size={11} />
                    </small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {item && !orders && !error && <div className="empty">{t('Lade Angebote …')}</div>}
      {item && orders && (
        <div className="orders-grid">
          <OrderTable title={t('Verkäufer (WTS)')} kind="sell" orders={orders.sell} item={item} />
          <OrderTable title={t('Käufer (WTB)')} kind="buy" orders={orders.buy} item={item} />
        </div>
      )}

      {picking && (
        <ItemPicker
          title="Item suchen"
          items={items}
          onClose={() => setPicking(false)}
          onPick={(i) => {
            setGearOpts(null);
            setItem(i);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

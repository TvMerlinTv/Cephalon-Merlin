import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Lock, Check, Coins, Wrench, Copy } from 'lucide-react';
import { wtsMessages, copyToClipboard } from '../lib/trade.js';
import { getPrice, openExternal } from '../lib/api.js';
import { marketItemFor, wikiFor } from '../lib/masteryDb.js';
import { evaluate } from '../lib/evaluate.js';
import { useGameData } from '../lib/GameData.jsx';
import { compact } from '../lib/format.js';
import { Plat, Ducat } from './Icons.jsx';
import TodoStar from './TodoStar.jsx';
import { useT } from '../lib/i18n.js';
import { openBuilds } from '../lib/builds.js';
import PriceAlertButton from './PriceAlertButton.jsx';

const STATUS_LABEL = {
  mastered: 'Gemeistert',
  leveling: 'Im Besitz',
  buildable: 'Baubar',
  blueprints: 'Blaupausen komplett',
  missing: 'Fehlt',
};

/** Preise eines Spiel-Items über warframe.market (sofern handelbar). */
function useMarket(gameId, fallbackItem) {
  const [state, setState] = useState({ item: fallbackItem ?? null, price: null });
  useEffect(() => {
    let alive = true;
    setState({ item: fallbackItem ?? null, price: null });
    (async () => {
      const m = fallbackItem ?? (gameId ? await marketItemFor(gameId) : null);
      if (!alive) return;
      setState({ item: m, price: null });
      if (m) {
        const price = await getPrice(m.slug).catch(() => null);
        if (alive) setState({ item: m, price });
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, fallbackItem]);
  return state;
}

/** Verkaufen: Preis + Menge wählen, WTS-Nachricht für den Trade-Chat kopieren oder warframe.market öffnen. */
function SellBox({ item, price }) {
  const t = useT();
  const { inventory } = useGameData();
  const owned = (item.gameRef && inventory?.counts?.[item.gameRef]) || 0;
  const [qty, setQty] = useState(1);
  const [plat, setPlat] = useState(null); // null = Marktpreis übernehmen
  const [copied, setCopied] = useState(false);
  if (!owned) return null;
  const value = plat ?? price?.wts ?? '';
  const n = Math.min(Math.max(1, qty), owned);
  const copy = async () => {
    const [msg] = wtsMessages([{ name: item.name, qty: n, price: Number(value) || 1 }]);
    await copyToClipboard(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="sell-box">
      <h4>{t('Verkaufen')}</h4>
      <div className="sell-row">
        <label>
          <span>{t('Menge')}</span>
          <input type="number" min="1" max={owned} value={n} onChange={(e) => setQty(Math.round(Number(e.target.value) || 1))} />
          <small className="muted">/ {owned}</small>
        </label>
        <label>
          <span>{t('Preis')}</span>
          <input
            type="number"
            min="1"
            value={value}
            placeholder="–"
            onChange={(e) => setPlat(Math.max(1, Math.round(Number(e.target.value) || 0)))}
          />
          <Plat />
        </label>
        <button className="btn btn-primary" onClick={copy} disabled={!value}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {t('WTS-Nachricht kopieren')}
        </button>
        <button className="btn" onClick={() => openExternal(`https://warframe.market/items/${item.slug}`)}>
          {t('Auf warframe.market einstellen')} <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}

function PriceTags({ gameId, marketItem }) {
  const t = useT();
  const { item, price } = useMarket(gameId, marketItem);
  if (!item) return <p className="muted small">{t('Nicht auf warframe.market handelbar.')}</p>;
  return (
    <>
      <div className="detail-prices">
        <span className="price wts">
          SELL <b>{price ? price.wts ?? '–' : '…'}</b> <Plat />
        </span>
        <span className="price wtb">
          BUY <b>{price ? price.wtb ?? '–' : '…'}</b> <Plat />
        </span>
        <button className="icon-btn" title={t('Auf warframe.market')} onClick={() => openExternal(`https://warframe.market/items/${item.slug}`)}>
          <ExternalLink size={15} />
        </button>
        <PriceAlertButton key={item.slug} item={item} price={price} />
      </div>
      <SellBox key={item.slug} item={item} price={price} />
    </>
  );
}

function Drops({ drops }) {
  const t = useT();
  if (!drops?.length) return <div className="drops-empty">{t('Keine Fundorte bekannt (Markt, Clan-Dojo, Händler oder Quest).')}</div>;
  return (
    <table className="drops">
      <thead>
        <tr>
          <th>{t('Fundort')}</th>
          <th>{t('Seltenheit')}</th>
          <th>{t('Chance')}</th>
        </tr>
      </thead>
      <tbody>
        {drops.map((d, i) => (
          <tr key={i}>
            <td>{d.location}</td>
            <td className="muted">{d.rarity ?? ''}</td>
            <td className="num">{d.chance != null ? `${d.chance} %` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Details zu einem Mastery-Item (Warframe, Waffe, Begleiter …) */
function MasteryDetails({ item, initialPartId }) {
  const t = useT();
  const { inventory } = useGameData();
  const row = useMemo(() => evaluate(item, inventory), [item, inventory]);
  const entries = [{ id: item.id, name: item.name, image: item.image, isSet: true, count: 1 }, ...row.parts];
  const [selectedId, setSelectedId] = useState(
    entries.some((e) => e.id === initialPartId) ? initialPartId : row.parts.find((p) => p.built + p.bp < p.count)?.id ?? item.id,
  );
  const sel = entries.find((e) => e.id === selectedId) ?? entries[0];
  const selWiki = sel.isSet || sel.id.includes('/Recipes/') ? (item.wiki ? `${item.wiki}#Acquisition` : wikiFor(item.name)) : wikiFor(sel.name);

  return (
    <>
      <div className="detail-top">
        <div className="detail-img">{item.image && <img src={item.image} alt="" />}</div>
        <div className="detail-info">
          <div className="detail-title">
            <h2>
              {item.name} <TodoStar id={item.id} size={20} />
            </h2>
            <span className="detail-title-actions">
              <button className="btn btn-outline" onClick={() => openBuilds(item.name)} title={t('Builds von overframe.gg für dieses Item')}>
                <Wrench size={13} /> Builds
              </button>
              <button className="btn btn-outline" onClick={() => openExternal(item.wiki ?? wikiFor(item.name))}>
                {t('Wiki-Link')} <ExternalLink size={13} />
              </button>
            </span>
          </div>
          <div className="detail-boxes">
            <dl className="facts">
              <dt>{t('Kategorie')}</dt>
              <dd>{t(item.category)}</dd>
              <dt>{t('Mastery-Rang')}</dt>
              <dd>MR {item.masteryReq}</dd>
              <dt>{t('Status')}</dt>
              <dd className={`status-text ${row.status}`}>
                {t(STATUS_LABEL[row.status])}
                {row.status === 'leveling' && ` · ${t('Rang {a}/{b}', { a: row.rank, b: item.maxRank })}`}
              </dd>
              {item.vaulted != null && (
                <>
                  <dt>Vaulted</dt>
                  <dd>
                    {item.vaulted ? (
                      <span className="tag tag-vault">
                        <Lock size={11} /> {t('Ja')}
                      </span>
                    ) : (
                      t('Nein')
                    )}
                  </dd>
                </>
              )}
            </dl>
            <div className="build-box">
              <h4>{t('Zum Bauen')}</h4>
              <ul className="res-list">
                <li className={row.creditsOk ? 'ok' : 'bad'}>
                  <Coins size={14} /> Credits <span>{compact(item.credits)}</span>
                </li>
                {row.resources.map((r) => (
                  <li key={r.id} className={r.built >= r.count ? 'ok' : 'bad'}>
                    {r.image && <img src={r.image} alt="" />} {r.name}
                    <span>
                      {compact(r.built)}/{compact(r.count)}
                    </span>
                  </li>
                ))}
                {row.resources.length === 0 && <li className="muted">{t('Keine Rohstoffe nötig.')}</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-bottom">
        <div className="components">
          <h3>{t('Bauteile')}</h3>
          <ul>
            {entries.map((e) => {
              const ok = e.isSet ? row.owned : e.built >= e.count;
              const bpOnly = !e.isSet && !ok && e.built + e.bp >= e.count;
              return (
                <li key={e.id}>
                  <button className={`${e.id === sel.id ? 'active' : ''} ${ok ? 'ok' : bpOnly ? 'bp' : ''}`} onClick={() => setSelectedId(e.id)}>
                    <span className="comp-img">{e.image && <img src={e.image} alt="" />}</span>
                    <span className="comp-name">{e.isSet ? `${item.name} (Set)` : e.name}</span>
                    {!e.isSet && (
                      <span className="comp-count" title={bpOnly ? t('Nur als Blaupause – muss noch gebaut werden') : ''}>
                        {ok && <Check size={12} />}
                        {Math.min(e.built + e.bp, e.count)}/{e.count}
                        {bpOnly && ' BP'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="component-detail">
          <div className="component-head">
            <div className="comp-big">{sel.image && <img src={sel.image} alt="" />}</div>
            <div>
              <h3>{sel.isSet ? `${item.name} (Set)` : `${item.name} – ${sel.name}`}</h3>
              {sel.ducats != null && (
                <p className="muted">
                  <Ducat /> {t('{n} Ducats', { n: sel.ducats })}
                </p>
              )}
              <PriceTags gameId={sel.id} />
              <button className="btn btn-outline small-btn" onClick={() => openExternal(selWiki)}>
                {t('Wie farme ich das? (Wiki)')} <ExternalLink size={13} />
              </button>
            </div>
          </div>
          <h4>{t('Fundorte')}</h4>
          {sel.isSet ? <div className="drops-empty">{t('Wähle links ein Bauteil, um seine Fundorte zu sehen.')}</div> : <Drops drops={sel.drops} />}
        </div>
      </div>
    </>
  );
}

/** Details zu einem reinen Markt-Item (Mod, Relikt, Arcane …) ohne Bauplan. */
function MarketDetails({ marketItem, qty }) {
  const t = useT();
  return (
    <div className="detail-top">
      <div className="detail-img">{marketItem.thumb && <img src={marketItem.thumb.replace('/thumbs/', '/').replace(/\.128x128\.png$/, '.png')} alt="" onError={(e) => (e.currentTarget.src = marketItem.thumb)} />}</div>
      <div className="detail-info">
        <div className="detail-title">
          <h2>{marketItem.name}</h2>
          <button className="btn btn-outline" onClick={() => openExternal(wikiFor(marketItem.name))}>
            {t('Wiki-Link')} <ExternalLink size={13} />
          </button>
        </div>
        <dl className="facts">
          {qty != null && (
            <>
              <dt>{t('Im Besitz')}</dt>
              <dd>x{qty}</dd>
            </>
          )}
          {marketItem.ducats != null && (
            <>
              <dt>Ducats</dt>
              <dd>
                <Ducat /> {marketItem.ducats}
              </dd>
            </>
          )}
          <dt>Tags</dt>
          <dd className="muted">{marketItem.tags.join(', ')}</dd>
        </dl>
        <PriceTags marketItem={marketItem} />
      </div>
    </div>
  );
}

/**
 * Item-Details-Fenster.
 * Entweder `item` (Mastery-Item, optional `partId`) oder `marketItem` (warframe.market-Item).
 */
export default function ItemDetails({ item, partId, marketItem, qty, onClose }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal details" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Item-Details')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('Schließen')}>
            <X size={20} />
          </button>
        </div>
        {item ? (
          <MasteryDetails key={`${item.id}|${partId ?? ''}`} item={item} initialPartId={partId} />
        ) : (
          <MarketDetails marketItem={marketItem} qty={qty} />
        )}
      </div>
    </div>
  );
}

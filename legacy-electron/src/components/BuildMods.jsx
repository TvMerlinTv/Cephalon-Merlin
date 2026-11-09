import { useCallback, useEffect, useRef, useState } from 'react';
import { Store, ExternalLink, X } from 'lucide-react';
import { getItems, getPrice, openExternal } from '../lib/api.js';
import { openMarket } from '../lib/builds.js';
import { Plat } from './Icons.jsx';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';

// Mod-Belegung eines Overframe-Builds. slots[].mod sind Overframe-eigene IDs; die Zuordnung zu
// DE-Mods steht in src/lib/overframeMods.json (build/make-overframe-mods.cjs) und wird erst hier nachgeladen.
// Bilder: die Mod-Karten von warframe.market (wie im Inventar, über gameRef = DE-Pfad), sonst WFCD-Bilder.
// Die Datei liegt nicht im Repository (aus Overframes Webseite ausgelesen) – fehlt sie, baut die App trotzdem,
// die Builds zeigen dann nur keine Mod-Belegung.
const modFiles = import.meta.glob('../lib/overframeMods.json');
let dataPromise = null;
export function loadData() {
  const loadMods = modFiles['../lib/overframeMods.json'];
  dataPromise ??= Promise.all([
    loadMods ? loadMods().then((m) => m.default.mods) : Promise.resolve({}),
    getItems()
      .then((items) => new Map(items.filter((i) => i.gameRef).map((i) => [i.gameRef, i])))
      .catch(() => new Map()),
  ]).then(([mods, market]) => ({ mods, market }));
  return dataPromise;
}
// Vorschaubild -> großes Kartenbild (…/thumbs/x.128x128.webp -> …/x.webp)
export const fullCard = (thumb) => thumb.replace('/thumbs/', '/').replace(/\.128x128(\.\w+)$/, '$1');

export const WFCD_IMG = 'https://cdn.warframestat.us/img/';
// Overframe-Polaritätsnummer -> Name (1–5 und 9 an echten Builds geprüft, 6–8 nach DEs Reihenfolge)
const POLARITY = {
  1: ['Madurai', 'M'],
  2: ['Vazarin', 'V'],
  3: ['Naramon', 'N'],
  4: ['Zenurik', 'Z'],
  5: ['Penjaga', 'P'],
  6: ['Koneksi', 'K'],
  7: ['Unairu', 'U'],
  8: ['Umbra', 'Ω'],
  9: ['Aura / Omni', '◇'],
};
const KIND_LABEL = { aura: 'Aura', stance: 'Haltung', arcane: 'Arcane', exilus: 'Exilus' };

function Rank({ rank, max }) {
  if (!max) return <span className="bm-rank-text">R{rank}</span>;
  return (
    <span className="bm-rank" title={`${rank}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < rank ? 'on' : ''} />
      ))}
    </span>
  );
}

function Drain({ slot, kind }) {
  const t = useT();
  if (kind === 'arcane') return null;
  const pol = POLARITY[slot.polarity];
  const match = slot.polarity_match === 2 ? 'match' : slot.polarity_match === 0 ? 'miss' : '';
  return (
    <span className={`bm-drain ${match}`} title={pol ? t('Polarität: {p}', { p: pol[0] }) : t('Ohne Polarität')}>
      {kind === 'aura' ? `+${Math.abs(slot.drain)}` : slot.drain}
      {pol && <span className="bm-pol">{pol[1]}</span>}
    </span>
  );
}

// Beim Klick auf eine Mod: Preise und Wege zum Markt
function MarketPanel({ market, name, rank, onClose }) {
  const t = useT();
  const [price, setPrice] = useState(null); // Rang 0
  const [maxPrice, setMaxPrice] = useState(null); // Max-Rang
  const max = market?.maxRank ?? 0;
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    // Mods: Rang 0 und Max getrennt – gemischt wären die Preise verfälscht
    if (market) getPrice(market.slug).then((p) => alive && setPrice(p)).catch(() => alive && setPrice({}));
    if (market && max > 0)
      getPrice(market.slug, { rank: max }).then((p) => alive && setMaxPrice(p)).catch(() => alive && setMaxPrice({}));
    const close = (e) => !ref.current?.parentElement?.contains(e.target) && onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      alive = false;
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [market, max, onClose]);
  return (
    <div className="bm-market" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="bm-market-head">
        <b>{name}</b>
        <button className="icon-btn" onClick={onClose} aria-label={t('Schließen')}>
          <X size={14} />
        </button>
      </div>
      {market ? (
        <>
          {/* Zum Kaufen zählt nur das günstigste Angebot (online/ingame) */}
          <div className="bm-market-prices" title={t('Günstigstes Angebot von Spielern, die gerade online sind')}>
            <span className="muted small">{t('Kaufen ab')}</span>
            {max > 0 ? (
              <>
                <span className={`bm-price-row ${rank >= max ? 'hit' : ''}`}>
                  <small>{t('Max (Rang {n})', { n: max })}</small>
                  <span className="price wts">
                    <b>{maxPrice ? maxPrice.wts ?? '–' : '…'}</b> <Plat />
                  </span>
                </span>
                <span className={`bm-price-row ${rank < max ? 'hit' : ''}`}>
                  <small>{t('Rang 0')}</small>
                  <span className="price wts">
                    <b>{price ? price.wts ?? '–' : '…'}</b> <Plat />
                  </span>
                </span>
              </>
            ) : (
              <span className="price wts">
                <b>{price ? price.wts ?? '–' : '…'}</b> <Plat />
              </span>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => openMarket(market.slug)}>
            <Store size={14} /> {t('Im Markt ansehen')}
          </button>
          <button className="btn" onClick={() => openExternal(`https://warframe.market/items/${market.slug}`)}>
            <ExternalLink size={14} /> {t('Auf warframe.market')}
          </button>
        </>
      ) : (
        <p className="muted small">{t('Nicht auf warframe.market handelbar.')}</p>
      )}
    </div>
  );
}

function ModCard({ slot, mod, market, kind, label, open, onToggle }) {
  const card = market?.thumb;
  const t = useT();
  const { language } = useSettings();
  const [src, setSrc] = useState(card ? fullCard(card) : null);
  useEffect(() => setSrc(card ? fullCard(card) : null), [card]);

  if (!slot?.mod)
    return (
      <div className={`bm-slot ${kind === 'arcane' ? 'bm-slot-arcane' : ''}`}>
        <div className={`bm-card bm-empty ${kind === 'arcane' ? 'bm-round' : ''}`}>{label && <small>{t(label)}</small>}</div>
      </div>
    );

  const name = mod ? (language === 'de' && mod.d) || mod.n : t('Unbekannte Mod #{id}', { id: slot.mod });
  const rar = `rar-${mod?.ra ?? 'common'}`;
  // Großes Kartenbild von warframe.market; lädt es nicht, das kleine, dann gar keins (Ersatzkarte)
  const onError = () => setSrc((s) => (s && card && s !== card ? card : null));
  const art = src ?? (mod?.i ? WFCD_IMG + mod.i : null);
  const tip = mod ? null : t('Diese Mod fehlt in der Zuordnungsliste – auf Overframe ansehen.');

  if (kind === 'arcane')
    return (
      <div className={`bm-slot bm-slot-arcane bm-click ${open ? 'open' : ''}`} onClick={onToggle} title={`${name} · ${t('Rang {a}/{b}', { a: slot.rank, b: mod?.r ?? '?' })}`}>
        <div className={`bm-card bm-round ${rar}`}>{art && <img src={art} alt="" loading="lazy" onError={onError} />}</div>
        <span className="bm-name">{name}</span>
        <Rank rank={slot.rank} max={mod?.r} />
        {open && <MarketPanel market={market} name={name} rank={slot.rank} onClose={onToggle} />}
      </div>
    );

  return (
    <div
      className={`bm-slot bm-click ${open ? 'open' : ''}`}
      title={tip ?? undefined}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
    >
      {label && <small className="bm-label">{t(label)}</small>}
      {/* Eingeklappt: breite Leiste mit Bildausschnitt, Name, Drain und Rang – wie auf overframe.gg */}
      <div className={`bm-card bm-strip ${rar} ${mod ? '' : 'bm-unknown'}`}>
        {art && <img className={src ? 'bm-strip-card' : 'bm-strip-art'} src={art} alt="" loading="lazy" onError={onError} />}
        <span className="bm-strip-name">{name}</span>
        <Drain slot={slot} kind={kind} />
        <span className="bm-strip-rank">
          <Rank rank={slot.rank} max={mod?.r} />
        </span>
      </div>
      {/* Beim Drüberfahren: die ganze Karte */}
      <div className={`bm-full ${rar}`} aria-hidden="true">
        {src ? (
          <img src={src} alt="" loading="lazy" onError={onError} />
        ) : (
          <div className="bm-fallback">
            <span className="bm-fb-img">{art && <img src={art} alt="" loading="lazy" />}</span>
            <b>{name}</b>
            <small>{t('Rang {a}/{b}', { a: slot.rank, b: mod?.r ?? '?' })}</small>
          </div>
        )}
        <Drain slot={slot} kind={kind} />
        {/* Kartenbilder zeigen den Rang schon selbst */}
        {!src && (
          <span className="bm-full-rank">
            <Rank rank={slot.rank} max={mod?.r} />
          </span>
        )}
      </div>
      {open && <MarketPanel market={market} name={name} rank={slot.rank} onClose={onToggle} />}
    </div>
  );
}

export default function BuildMods({ slots }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [openSlot, setOpenSlot] = useState(null); // Mod mit offenem Markt-Fenster
  const toggle = useCallback((id) => () => setOpenSlot((cur) => (cur === id ? null : id)), []);
  useEffect(() => {
    loadData()
      .then(setData)
      .catch(() => setData({ mods: {}, market: new Map() }));
  }, []);
  useEffect(() => setOpenSlot(null), [slots]);
  if (!slots?.length) return null;
  if (!data) return <div className="bm-loading muted small">{t('Lade Mods …')}</div>;

  const { mods, market } = data;
  const bySlot = new Map(slots.map((s) => [s.slot_id, s]));
  const kindOf = (s) => mods[s?.mod]?.k ?? 'mod';
  const extra = slots.filter((s) => s.slot_id > 8);
  // Begleiter haben 10 normale Mod-Plätze, alle anderen 8 plus Aura/Haltung/Exilus/Arcanes
  const companion = slots.length === 10 && extra.every((s) => kindOf(s) === 'mod');
  // Reihenfolge wie auf overframe.gg: oben Platz 8–5, unten 4–1
  const rows = companion ? [[10, 9, 8, 7, 6], [5, 4, 3, 2, 1]] : [[8, 7, 6, 5], [4, 3, 2, 1]];
  // Leere Plätze hinter dem ersten Arcane sind auch Arcane-Plätze
  const firstArcane = Math.min(...extra.filter((s) => s.mod && kindOf(s) === 'arcane').map((s) => s.slot_id));
  const isArcane = (s) => (s.mod ? kindOf(s) === 'arcane' : s.slot_id > firstArcane);
  const special = companion ? [] : extra.filter((s) => !isArcane(s));
  const arcanes = companion ? [] : extra.filter(isArcane);

  const card = (s, kind, label) => (
    <ModCard
      key={s?.slot_id ?? label}
      slot={s}
      mod={mods[s?.mod]}
      market={market.get(mods[s?.mod]?.p)}
      kind={kind}
      label={label}
      open={openSlot === s?.slot_id}
      onToggle={toggle(s?.slot_id)}
    />
  );

  return (
    <section className={`bm ${companion ? 'bm-companion' : ''}`}>
      {special.length > 0 && (
        <div className="bm-row bm-center">
          {special.map((s) => {
            const k = s.mod && kindOf(s) !== 'mod' ? kindOf(s) : s.mod ? 'exilus' : 'exilus';
            return card(s, k === 'exilus' ? 'mod' : k, KIND_LABEL[k]);
          })}
        </div>
      )}
      {rows.map((row, i) => (
        <div className="bm-row" key={i}>
          {row.map((id) => card(bySlot.get(id) ?? { slot_id: id }, 'mod'))}
        </div>
      ))}
      {arcanes.length > 0 && <div className="bm-row bm-center bm-arcanes">{arcanes.map((s) => card(s, 'arcane', 'Arcane'))}</div>}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { getPrice, getCachedPrice } from '../lib/api.js';
import { Ducat } from './Icons.jsx';
import { useT } from '../lib/i18n.js';

/** Lädt den Preis erst, wenn die Karte sichtbar wird (schont das Rate-Limit). */
export function usePrice(slug) {
  const ref = useRef(null);
  const [price, setPrice] = useState(() => getCachedPrice(slug));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      getPrice(slug).then(setPrice).catch(() => setPrice((p) => p ?? { wts: null, wtb: null, error: true }));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [slug]);
  return [ref, price];
}

/**
 * Inventar-Karte. Preise werden weiter geladen (für Gesamtwert und Sortierung), aber nicht auf der Karte
 * gezeigt – Preise und Verkaufen gibt es in den Details.
 * `image`: großes Bild (bei Teilen die Waffe/der Frame); `badge`: kleines Teil-Symbol im Kreis.
 */
const RARITY = ['common', 'uncommon', 'rare', 'legendary'];
const RARITY_DE = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', legendary: 'Legendär' };

/** Kurze Typ-Zeile aus den warframe.market-Tags (z. B. „Mod · Rare“, „Relikt“, „Arcane“). */
function typeLabel(tags, t) {
  const has = (x) => tags.includes(x);
  const rarity = RARITY.find(has);
  const rar = rarity ? ` · ${t(RARITY_DE[rarity])}` : '';
  if (has('mod')) return t('Mod') + rar;
  if (has('arcane_enhancement')) return t('Arcane') + rar;
  if (has('relic')) return t('Relikt');
  if (has('prime') && (has('component') || has('blueprint'))) return t('Prime-Teil');
  if (has('fish')) return t('Fisch');
  if (has('scene')) return 'Captura';
  return t('Item');
}

export default function ItemCard({ item, qty, image, badge, subtitle, onPrice, onOpen }) {
  const t = useT();
  const [ref, price] = usePrice(item.slug);

  useEffect(() => {
    if (price && onPrice) onPrice(item.slug, price);
  }, [price, item.slug, onPrice]);

  const src = image ?? item.thumb;
  const rarity = RARITY.find((r) => item.tags.includes(r));
  return (
    <article className={`item-card inv-card${rarity ? ` rar-${rarity}` : ''}`} ref={ref} onClick={() => onOpen(item)}>
      <div className="inv-art" title={t('Details anzeigen')}>
        {src && <img src={src} alt="" loading="lazy" onError={(e) => item.thumb && e.currentTarget.src !== item.thumb && (e.currentTarget.src = item.thumb)} />}
        {badge && (
          <span className="item-badge">
            <img src={badge} alt="" loading="lazy" />
          </span>
        )}
      </div>
      <div className="inv-main">
        <button className="inv-name" onClick={(e) => (e.stopPropagation(), onOpen(item))} title={t('Details anzeigen')}>
          {item.name}
        </button>
        <span className="inv-sub">{subtitle ?? typeLabel(item.tags, t)}</span>
        <div className="inv-chips">
          <span className="inv-chip" title={t('Menge laut letztem Sync mit dem Spiel')}>
            x{qty}
          </span>
          {item.ducats != null && (
            <span className="inv-chip" title="Ducats">
              <Ducat size={14} /> {item.ducats}
              {qty > 1 && <small>· {(item.ducats * qty).toLocaleString()}</small>}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

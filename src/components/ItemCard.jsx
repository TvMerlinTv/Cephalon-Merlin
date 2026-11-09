import { onCleanup, onMount, Show } from 'solid-js';
import { cachedPrice, loadPrice } from '../lib/market.js';
import { Ducat } from './Icons.jsx';
import { t } from '../lib/i18n.js';

const RARITY = ['common', 'uncommon', 'rare', 'legendary'];
const RARITY_DE = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', legendary: 'Legendär' };

/** Kurze Typ-Zeile aus den warframe.market-Tags (z. B. „Mod · Rare“, „Relikt“, „Arcane“). */
export function typeLabel(tags) {
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

/**
 * Inventar-Karte. Der Preis wird erst geladen, wenn die Karte sichtbar wird (schont das Rate-Limit);
 * gezeigt wird er in den Details, gezählt im Gesamtwert.
 */
export default function ItemCard(props) {
  let el;
  onMount(() => {
    if (cachedPrice(props.item.slug)?.ts > Date.now() - 15 * 60 * 1000) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      loadPrice(props.item.slug).catch(() => {});
    });
    io.observe(el);
    onCleanup(() => io.disconnect());
  });
  const rarity = () => RARITY.find((r) => props.item.tags.includes(r));
  const price = () => cachedPrice(props.item.slug);

  return (
    <article ref={el} class={`item-card inv-card${rarity() ? ` rar-${rarity()}` : ''}`} onClick={() => props.onOpen(props.item)}>
      <div class="inv-art" title={t('Details anzeigen')}>
        <Show when={props.item.thumb}>
          <img src={props.item.thumb} alt="" loading="lazy" />
        </Show>
      </div>
      <div class="inv-main">
        <button class="inv-name" title={t('Details anzeigen')}>
          {props.item.name}
        </button>
        <span class="inv-sub">{typeLabel(props.item.tags)}</span>
        <div class="inv-chips">
          <span class="inv-chip" title={t('Menge laut letztem Sync mit dem Spiel')}>
            x{props.qty}
          </span>
          <Show when={props.item.ducats != null}>
            <span class="inv-chip" title="Ducats">
              <Ducat size={14} /> {props.item.ducats}
              <Show when={props.qty > 1}>
                <small>· {(props.item.ducats * props.qty).toLocaleString()}</small>
              </Show>
            </span>
          </Show>
          <Show when={price()?.wts != null}>
            <span class="inv-chip" title={t('Günstigstes Verkaufsangebot (WTS)')}>
              {price().wts} p
            </span>
          </Show>
        </div>
      </div>
    </article>
  );
}

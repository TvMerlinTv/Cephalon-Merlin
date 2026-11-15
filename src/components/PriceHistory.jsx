// Preisverlauf eines warframe.market-Items: abgeschlossene Handel der letzten 90 Tage (Median pro Tag).
// Die Daten holt der Rust-Teil über die gemeinsame Warteschlange (net.rs, 6 Stunden gemerkt).
import { createMemo, createResource, Show } from 'solid-js';
import { TrendingDown, TrendingUp, Minus } from 'lucide-solid';
import { call } from '../lib/ipc.js';
import { priceTrend, sparkPath } from '../lib/priceHistory.js';
import { t } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';

const W = 260;
const H = 46;

export default function PriceHistory(props) {
  const [points] = createResource(
    () => props.slug,
    (slug) => call('market_history', { slug }).catch(() => []),
  );
  const trend = createMemo(() => priceTrend(points() ?? []));
  const path = createMemo(() => sparkPath((points() ?? []).map((p) => p.median), W, H));
  return (
    <Show when={!points.loading && trend()}>
      {(tr) => (
        <div class="price-history" title={t('Median der abgeschlossenen Handel pro Tag (warframe.market)')}>
          <div class="ph-head">
            <b>{t('Preisverlauf · {n} Tage', { n: tr().days })}</b>
            <span class={`ph-trend ph-${tr().dir}`}>
              {tr().dir === 'up' ? <TrendingUp size={14} /> : tr().dir === 'down' ? <TrendingDown size={14} /> : <Minus size={14} />}
              {tr().dir === 'flat' ? t('stabil') : `${tr().change > 0 ? '+' : ''}${tr().change} %`}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="ph-chart" aria-hidden="true">
            <path d={`${path()} L${W} ${H} L0 ${H} Z`} class="ph-area" />
            <path d={path()} class="ph-line" />
          </svg>
          <div class="ph-facts">
            <span>
              {t('Tief')} {tr().min} <Plat size={11} />
            </span>
            <span>
              {t('Ø')} {tr().avg} <Plat size={11} />
            </span>
            <span>
              {t('Hoch')} {tr().max} <Plat size={11} />
            </span>
            <span class="muted">{t('{n} Handel/Tag', { n: tr().volume })}</span>
          </div>
          <Show when={tr().hint}>
            <p class="muted small ph-hint">{t(tr().hint)}</p>
          </Show>
        </div>
      )}
    </Show>
  );
}

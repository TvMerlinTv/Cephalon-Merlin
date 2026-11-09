// Mod-Belegung eines Overframe-Builds. slots[].mod sind Overframe-eigene IDs; die Zuordnung zu
// DE-Mods steht in src/lib/overframeMods.json (nicht im Repository – fehlt sie, zeigen die Builds
// nur keine Mod-Belegung). Bilder: Mod-Karten von warframe.market, sonst WFCD-Bilder.
import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Store, ExternalLink, X } from 'lucide-solid';
import { getItems, cachedPrice, loadPrice } from '../lib/market.js';
import { openExternal } from '../lib/ipc.js';
import { openMarket } from '../pages/Market.jsx';
import { Plat } from './Icons.jsx';
import PolarityIcon from './Polarity.jsx';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';

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
/** Vorschaubild -> großes Kartenbild (…/thumbs/x.128x128.webp -> …/x.webp) */
export const fullCard = (thumb) => thumb.replace('/thumbs/', '/').replace(/\.128x128(\.\w+)$/, '$1');
export const WFCD_IMG = 'https://cdn.warframestat.us/img/';

const POLARITY = {
  1: ['Madurai', 'madurai'],
  2: ['Vazarin', 'vazarin'],
  3: ['Naramon', 'naramon'],
  4: ['Zenurik', 'zenurik'],
  5: ['Penjaga', 'penjaga'],
  6: ['Koneksi', 'koneksi'],
  7: ['Unairu', 'unairu'],
  8: ['Umbra', 'umbra'],
  9: ['Aura / Omni', 'aura'],
};
const KIND_LABEL = { aura: 'Aura', stance: 'Haltung', arcane: 'Arcane', exilus: 'Exilus' };

function Rank(props) {
  return (
    <Show when={props.max} fallback={<span class="bm-rank-text">R{props.rank}</span>}>
      <span class="bm-rank" title={`${props.rank}/${props.max}`}>
        <For each={Array.from({ length: props.max }, (_, i) => i)}>{(i) => <i classList={{ on: i < props.rank }} />}</For>
      </span>
    </Show>
  );
}

function Drain(props) {
  const pol = () => POLARITY[props.slot.polarity];
  const match = () => (props.slot.polarity_match === 2 ? 'match' : props.slot.polarity_match === 0 ? 'miss' : '');
  return (
    <Show when={props.kind !== 'arcane'}>
      <span class={`bm-drain ${match()}`} title={pol() ? t('Polarität: {p}', { p: pol()[0] }) : t('Ohne Polarität')}>
        {props.kind === 'aura' ? `+${Math.abs(props.slot.drain)}` : props.slot.drain}
        <Show when={pol()}>
          <PolarityIcon name={pol()[1]} size="1.05em" />
        </Show>
      </span>
    </Show>
  );
}

// Beim Klick auf eine Mod: Preise (Rang 0 und Max getrennt) und Wege zum Markt
function MarketPanel(props) {
  let ref;
  const m = props.market;
  const max = m?.maxRank ?? 0;
  if (m) {
    loadPrice(m.slug).catch(() => {});
    if (max > 0) loadPrice(m.slug, { rank: max }).catch(() => {});
  }
  const close = (e) => !ref?.parentElement?.contains(e.target) && props.onClose();
  const esc = (e) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
  });
  onCleanup(() => {
    document.removeEventListener('mousedown', close);
    document.removeEventListener('keydown', esc);
  });
  const p0 = () => (m ? cachedPrice(m.slug) : null);
  const pMax = () => (m ? cachedPrice(m.slug, max) : null);
  return (
    <div class="bm-market" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div class="bm-market-head">
        <b>{props.name}</b>
        <button class="icon-btn" onClick={props.onClose} aria-label={t('Schließen')}>
          <X size={14} />
        </button>
      </div>
      <Show when={m} fallback={<p class="muted small">{t('Nicht auf warframe.market handelbar.')}</p>}>
        <div class="bm-market-prices" title={t('Günstigstes Angebot von Spielern, die gerade online sind')}>
          <span class="muted small">{t('Kaufen ab')}</span>
          <Show
            when={max > 0}
            fallback={
              <span class="price wts">
                <b>{p0() ? p0().wts ?? '–' : '…'}</b> <Plat />
              </span>
            }
          >
            <span class="bm-price-row" classList={{ hit: props.rank >= max }}>
              <small>{t('Max (Rang {n})', { n: max })}</small>
              <span class="price wts">
                <b>{pMax() ? pMax().wts ?? '–' : '…'}</b> <Plat />
              </span>
            </span>
            <span class="bm-price-row" classList={{ hit: props.rank < max }}>
              <small>{t('Rang 0')}</small>
              <span class="price wts">
                <b>{p0() ? p0().wts ?? '–' : '…'}</b> <Plat />
              </span>
            </span>
          </Show>
        </div>
        <button class="btn btn-primary" onClick={() => openMarket(m.slug)}>
          <Store size={14} /> {t('Im Markt ansehen')}
        </button>
        <button class="btn" onClick={() => openExternal(`https://warframe.market/items/${m.slug}`)}>
          <ExternalLink size={14} /> {t('Auf warframe.market')}
        </button>
      </Show>
    </div>
  );
}

function ModCard(props) {
  const slot = props.slot;
  const mod = props.mod;
  const card = props.market?.thumb;
  const [src, setSrc] = createSignal(card ? fullCard(card) : null);
  const name = () => (mod ? (settings.language === 'de' && mod.d) || mod.n : t('Unbekannte Mod #{id}', { id: slot.mod }));
  const rar = `rar-${mod?.ra ?? 'common'}`;
  // Großes Kartenbild; lädt es nicht, das kleine, dann gar keins (Ersatzkarte)
  const onError = () => setSrc((s) => (s && card && s !== card ? card : null));
  const art = () => src() ?? (mod?.i ? WFCD_IMG + mod.i : null);

  if (!slot?.mod)
    return (
      <div class="bm-slot" classList={{ 'bm-slot-arcane': props.kind === 'arcane' }}>
        <div class="bm-card bm-empty" classList={{ 'bm-round': props.kind === 'arcane' }}>
          <Show when={props.label}>
            <small>{t(props.label)}</small>
          </Show>
        </div>
      </div>
    );

  if (props.kind === 'arcane')
    return (
      <div class="bm-slot bm-slot-arcane bm-click" classList={{ open: props.open }} onClick={props.onToggle} title={`${name()} · ${t('Rang {a}/{b}', { a: slot.rank, b: mod?.r ?? '?' })}`}>
        <div class={`bm-card bm-round ${rar}`}>
          <Show when={art()}>
            <img src={art()} alt="" loading="lazy" onError={onError} />
          </Show>
        </div>
        <span class="bm-name">{name()}</span>
        <Rank rank={slot.rank} max={mod?.r} />
        <Show when={props.open}>
          <MarketPanel market={props.market} name={name()} rank={slot.rank} onClose={props.onToggle} />
        </Show>
      </div>
    );

  return (
    <div
      class="bm-slot bm-click"
      classList={{ open: props.open }}
      title={mod ? undefined : t('Diese Mod fehlt in der Zuordnungsliste – auf Overframe ansehen.')}
      tabIndex={0}
      onClick={props.onToggle}
      onKeyDown={(e) => e.key === 'Enter' && props.onToggle()}
    >
      <Show when={props.label}>
        <small class="bm-label">{t(props.label)}</small>
      </Show>
      {/* Eingeklappt: breite Leiste mit Bildausschnitt, Name, Drain und Rang – wie auf overframe.gg */}
      <div class={`bm-card bm-strip ${rar}`} classList={{ 'bm-unknown': !mod }}>
        <Show when={art()}>
          <img class={src() ? 'bm-strip-card' : 'bm-strip-art'} src={art()} alt="" loading="lazy" onError={onError} />
        </Show>
        <span class="bm-strip-name">{name()}</span>
        <Drain slot={slot} kind={props.kind} />
        <span class="bm-strip-rank">
          <Rank rank={slot.rank} max={mod?.r} />
        </span>
      </div>
      {/* Beim Drüberfahren: die ganze Karte */}
      <div class={`bm-full ${rar}`} aria-hidden="true">
        <Show
          when={src()}
          fallback={
            <div class="bm-fallback">
              <span class="bm-fb-img">
                <Show when={art()}>
                  <img src={art()} alt="" loading="lazy" />
                </Show>
              </span>
              <b>{name()}</b>
              <small>{t('Rang {a}/{b}', { a: slot.rank, b: mod?.r ?? '?' })}</small>
            </div>
          }
        >
          <img src={src()} alt="" loading="lazy" onError={onError} />
        </Show>
        <Drain slot={slot} kind={props.kind} />
        <Show when={!src()}>
          <span class="bm-full-rank">
            <Rank rank={slot.rank} max={mod?.r} />
          </span>
        </Show>
      </div>
      <Show when={props.open}>
        <MarketPanel market={props.market} name={name()} rank={slot.rank} onClose={props.onToggle} />
      </Show>
    </div>
  );
}

export default function BuildMods(props) {
  const [data] = createResource(() => loadData().catch(() => ({ mods: {}, market: new Map() })));
  const [openSlot, setOpenSlot] = createSignal(null);
  const toggle = (id) => () => setOpenSlot((cur) => (cur === id ? null : id));

  const layout = () => {
    const d = data();
    const slots = props.slots;
    if (!d || !slots?.length) return null;
    const { mods, market } = d;
    const bySlot = new Map(slots.map((s) => [s.slot_id, s]));
    const kindOf = (s) => mods[s?.mod]?.k ?? 'mod';
    const extra = slots.filter((s) => s.slot_id > 8);
    // Begleiter haben 10 normale Mod-Plätze, alle anderen 8 plus Aura/Haltung/Exilus/Arcanes
    const companion = slots.length === 10 && extra.every((s) => kindOf(s) === 'mod');
    const rows = companion ? [[10, 9, 8, 7, 6], [5, 4, 3, 2, 1]] : [[8, 7, 6, 5], [4, 3, 2, 1]];
    const firstArcane = Math.min(...extra.filter((s) => s.mod && kindOf(s) === 'arcane').map((s) => s.slot_id));
    const isArcane = (s) => (s.mod ? kindOf(s) === 'arcane' : s.slot_id > firstArcane);
    const special = companion ? [] : extra.filter((s) => !isArcane(s));
    const arcanes = companion ? [] : extra.filter(isArcane);
    return { mods, market, bySlot, kindOf, companion, rows, special, arcanes };
  };

  const card = (L, s, kind, label) => (
    <ModCard slot={s} mod={L.mods[s?.mod]} market={L.market.get(L.mods[s?.mod]?.p)} kind={kind} label={label} open={openSlot() === s?.slot_id} onToggle={toggle(s?.slot_id)} />
  );

  return (
    <Show when={props.slots?.length}>
      <Show when={layout()} fallback={<div class="bm-loading muted small">{t('Lade Mods …')}</div>}>
        {(L) => (
          <section class="bm" classList={{ 'bm-companion': L().companion }}>
            <Show when={L().special.length > 0}>
              <div class="bm-row bm-center">
                <For each={L().special}>
                  {(s) => {
                    const k = s.mod && L().kindOf(s) !== 'mod' ? L().kindOf(s) : 'exilus';
                    return card(L(), s, k === 'exilus' ? 'mod' : k, KIND_LABEL[k]);
                  }}
                </For>
              </div>
            </Show>
            <For each={L().rows}>
              {(row) => (
                <div class="bm-row">
                  <For each={row}>{(id) => card(L(), L().bySlot.get(id) ?? { slot_id: id }, 'mod')}</For>
                </div>
              )}
            </For>
            <Show when={L().arcanes.length > 0}>
              <div class="bm-row bm-center bm-arcanes">
                <For each={L().arcanes}>{(s) => card(L(), s, 'arcane', 'Arcane')}</For>
              </div>
            </Show>
          </section>
        )}
      </Show>
    </Show>
  );
}

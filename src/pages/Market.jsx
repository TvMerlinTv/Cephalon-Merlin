// Warframe Market: Item suchen oder in der Kachel-Auswahl anklicken -> Angebote von Spielern, die online sind.
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Search, Copy, Check, ExternalLink, ArrowLeft, X } from 'lucide-solid';
import { getItems } from '../lib/market.js';
import { loadBulkPrices, copyToClipboard } from '../lib/gamedb.js';
import { call, load, save, openExternal } from '../lib/ipc.js';
import GearBrowser from '../components/GearBrowser.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import { Plat } from '../components/Icons.jsx';
import { t } from '../lib/i18n.js';

const STATUS_DE = { ingame: 'Im Spiel', online: 'Online', offline: 'Offline' };

/** Andere Seiten (Preis-Alarm, Build-Mods) können ein Item vorwählen. */
export function openMarket(slug, rank = null) {
  save('cm.market.pending', slug);
  if (rank != null) save('cm.market.rank', rank ? 'max' : '0');
  window.dispatchEvent(new CustomEvent('cm:navigate', { detail: 'market' }));
  window.dispatchEvent(new CustomEvent('cm:market-item'));
}
function takeMarketItem() {
  const slug = load('cm.market.pending', null);
  if (slug) save('cm.market.pending', null);
  return slug;
}

function ItemPicker(props) {
  const [q, setQ] = createSignal('');
  const hits = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s.length < 2 ? [] : props.items.filter((i) => i.name.toLowerCase().includes(s)).slice(0, 40);
  });
  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3>{t('Item suchen')}</h3>
          <button class="icon-btn" onClick={props.onClose} aria-label={t('Schließen')}>
            <X size={18} />
          </button>
        </div>
        <label class="search big">
          <Search size={16} />
          <input ref={(el) => setTimeout(() => el.focus())} value={q()} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('z. B. Afuris Prime Barrel')} />
        </label>
        <ul class="picker-list">
          <For each={hits()}>
            {(i) => (
              <li>
                <button onClick={() => props.onPick(i)}>
                  <Show when={i.thumb}>
                    <img src={i.thumb} alt="" />
                  </Show>
                  <span>{i.name}</span>
                </button>
              </li>
            )}
          </For>
          <Show when={q().trim().length >= 2 && hits().length === 0}>
            <li class="muted">{t('Nichts gefunden.')}</li>
          </Show>
        </ul>
      </div>
    </div>
  );
}

function OrderTable(props) {
  const [copied, setCopied] = createSignal(null);
  const copy = async (o) => {
    const verb = props.kind === 'sell' ? 'buy' : 'sell';
    const rank = props.item.maxRank && o.rank != null ? ` (rank ${o.rank})` : '';
    await copyToClipboard(`/w ${o.user.ingameName} Hi! I want to ${verb}: "${props.item.name}"${rank} for ${o.platinum} platinum. (warframe.market)`).catch(() => {});
    setCopied(o.id);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <section class={`orders ${props.kind}`}>
      <h3>{props.title}</h3>
      <Show when={props.orders.length} fallback={<p class="muted">{t('Keine Angebote von Spielern, die gerade online sind.')}</p>}>
        <table>
          <thead>
            <tr>
              <th>{t('Spieler')}</th>
              <th>{t('Status')}</th>
              <th>{t('Ruf')}</th>
              <th>{t('Menge')}</th>
              <Show when={props.item.maxRank > 0}>
                <th>{t('Rang')}</th>
              </Show>
              <th>{t('Preis')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={props.orders}>
              {(o) => (
                <tr>
                  <td>{o.user.ingameName}</td>
                  <td>
                    <span class={`dot ${o.user.status}`} /> {t(STATUS_DE[o.user.status] ?? o.user.status)}
                  </td>
                  <td>{o.user.reputation}</td>
                  <td>{o.quantity}</td>
                  <Show when={props.item.maxRank > 0}>
                    <td class={o.rank === props.item.maxRank ? 'rank-max' : 'muted'}>
                      {o.rank ?? 0}/{props.item.maxRank}
                    </td>
                  </Show>
                  <td class="num">
                    {o.platinum} <Plat />
                  </td>
                  <td>
                    <button class="icon-btn" onClick={() => copy(o)} title={t('Flüster-Nachricht kopieren')}>
                      {copied() === o.id ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

export default function Market() {
  const [items] = createResource(() => getItems().catch(() => []));
  const [prices] = createResource(() => loadBulkPrices().catch(() => ({})));
  const [item, setItem] = createSignal(null);
  const [orders, setOrders] = createSignal(null);
  const [error, setError] = createSignal(null);
  const [picking, setPicking] = createSignal(false);
  const [details, setDetails] = createSignal(null);
  const [gearOpts, setGearOpts] = createSignal(null);
  const [rankMode, setRankMode] = createSignal(load('cm.market.rank', 'max'));
  const pickRank = (m) => {
    setRankMode(m);
    save('cm.market.rank', m);
  };

  // Vorgewähltes Item (z. B. Klick auf einen Preis-Alarm)
  const applyPending = () => {
    const slug = takeMarketItem();
    const pre = slug && items()?.find((i) => i.slug === slug);
    if (!pre) return;
    setRankMode(load('cm.market.rank', 'max'));
    setGearOpts(null);
    setItem(pre);
  };
  createEffect(on(items, (list) => list && applyPending()));
  window.addEventListener('cm:market-item', applyPending);
  onCleanup(() => window.removeEventListener('cm:market-item', applyPending));

  createEffect(
    on([item, rankMode], ([it, mode]) => {
      if (!it) return;
      setOrders(null);
      setError(null);
      const rank = it.maxRank ? (mode === 'max' ? it.maxRank : mode === '0' ? 0 : null) : null;
      call('market_top_orders', { slug: it.slug, rank })
        .then((o) => item() === it && setOrders(o))
        .catch((e) => setError(e.message));
    }),
  );

  const byName = (name) => items()?.find((i) => i.name.toLowerCase() === name.toLowerCase()) ?? null;
  const byRef = createMemo(() => new Map((items() ?? []).filter((i) => i.gameRef).map((i) => [i.gameRef, i])));
  const marketItemFor = (id) => byRef().get(id) ?? byRef().get(id.replace(/Component$/, 'Blueprint')) ?? null;

  /** Set + alle Bauteile, die es auf warframe.market gibt (Leiste über den Angeboten). */
  const tradeOptions = (gear) => {
    const opts = [];
    const set = byName(`${gear.name} Set`) ?? marketItemFor(gear.id) ?? byName(gear.name);
    if (set) opts.push({ key: gear.id, label: set.name.endsWith(' Set') ? 'Set' : gear.name, image: gear.image, market: set });
    for (const part of gear.components) {
      if (part.kind !== 'part') continue;
      const m = marketItemFor(part.id) ?? byName(`${gear.name} ${part.name}`);
      if (m && !opts.some((o) => o.market.slug === m.slug)) opts.push({ key: part.id, label: part.name, count: part.count, image: part.image, market: m });
    }
    return opts;
  };
  // Nicht handelbar (z. B. Ash)? Dann die Item-Details mit Bauplan und Fundorten.
  const pickGear = (gear) => {
    const opts = tradeOptions(gear);
    if (!opts.length) return setDetails({ item: gear });
    setGearOpts(opts);
    setItem(opts[0].market);
  };
  const pickPart = (gear, part) => {
    const opts = tradeOptions(gear);
    const hit = opts.find((o) => o.key === part.id);
    if (!hit) return setDetails({ item: gear, partId: part.id });
    setGearOpts(opts);
    setItem(hit.market);
  };

  return (
    <div class="page">
      <div class="toolbar">
        <Show when={item()}>
          <button class="btn" onClick={() => setItem(null)} title={t('Zurück zur Auswahl')}>
            <ArrowLeft size={15} /> {t('Auswahl')}
          </button>
        </Show>
        <button class="search big as-button" onClick={() => setPicking(true)}>
          <Search size={16} /> {item() ? item().name : t('Item auf warframe.market suchen …')}
        </button>
        <Show when={item()?.maxRank > 0}>
          <div class="seg seg-text" title={t('Angebote nach Mod-Rang')}>
            <button classList={{ active: rankMode() === 'max' }} onClick={() => pickRank('max')}>
              {t('Max (Rang {n})', { n: item().maxRank })}
            </button>
            <button classList={{ active: rankMode() === '0' }} onClick={() => pickRank('0')}>
              {t('Rang 0')}
            </button>
            <button classList={{ active: rankMode() === 'all' }} onClick={() => pickRank('all')}>
              {t('Alle')}
            </button>
          </div>
        </Show>
        <Show when={item()}>
          <button class="btn" onClick={() => openExternal(`https://warframe.market/items/${item().slug}`)}>
            <ExternalLink size={15} /> {t('Auf warframe.market')}
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <p class="err">{error()}</p>
      </Show>
      <Show when={!item()}>
        <GearBrowser onPick={pickGear} onPickPart={pickPart} />
      </Show>
      <Show when={item() && gearOpts()?.length > 1}>
        <div class="trade-opts">
          <For each={gearOpts()}>
            {(o) => {
              const price = () => (prices() ?? {})[o.market.name.toLowerCase()];
              return (
                <button class="trade-opt" classList={{ active: o.market.slug === item()?.slug }} onClick={() => setItem(o.market)} title={o.market.name}>
                  <span class="trade-img">
                    <Show when={o.image}>
                      <img src={o.image} alt="" />
                    </Show>
                  </span>
                  <span class="trade-txt">
                    <b>
                      {o.label}
                      {o.count > 1 ? ` ×${o.count}` : ''}
                    </b>
                    <Show when={price() > 0}>
                      <small>
                        ≈ {Math.round(price())} <Plat size={11} />
                      </small>
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={item() && !orders() && !error()}>
        <div class="empty">{t('Lade Angebote …')}</div>
      </Show>
      <Show when={item() && orders()}>
        <div class="orders-grid">
          <OrderTable title={t('Verkäufer (WTS)')} kind="sell" orders={orders().sell ?? []} item={item()} />
          <OrderTable title={t('Käufer (WTB)')} kind="buy" orders={orders().buy ?? []} item={item()} />
        </div>
      </Show>
      <Show when={details()}>
        <ItemDetails item={details().item} partId={details().partId} onClose={() => setDetails(null)} />
      </Show>
      <Show when={picking()}>
        <ItemPicker
          items={items() ?? []}
          onClose={() => setPicking(false)}
          onPick={(i) => {
            setGearOpts(null);
            setItem(i);
            setPicking(false);
          }}
        />
      </Show>
    </div>
  );
}

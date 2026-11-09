// Item-Details-Fenster: entweder `item` (Mastery-Item, optional `partId`) oder `marketItem` (warframe.market-Item).
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { X, ExternalLink, Lock, Check, Coins, Wrench, Copy } from 'lucide-solid';
import { getItems, cachedPrice, loadPrice } from '../lib/market.js';
import { evaluate, compact, wikiFor, copyToClipboard } from '../lib/gamedb.js';
import { game } from '../lib/game.js';
import { openExternal } from '../lib/ipc.js';
import { openBuilds } from '../lib/builds.js';
import { Plat, Ducat } from './Icons.jsx';
import TodoStar from './TodoStar.jsx';
import PriceAlertButton from './PriceAlertButton.jsx';
import { t } from '../lib/i18n.js';
import { materialClick } from './MaterialInfo.jsx';

const STATUS_LABEL = { mastered: 'Gemeistert', leveling: 'Im Besitz', buildable: 'Baubar', blueprints: 'Blaupausen komplett', missing: 'Fehlt' };

/** warframe.market-Item zu einer Spiel-ID (Bauteile werden dort als Blaupause gehandelt). */
let byRef = null;
async function marketItemFor(id) {
  if (!byRef) byRef = new Map((await getItems()).filter((i) => i.gameRef).map((i) => [i.gameRef, i]));
  return byRef.get(id) ?? byRef.get(id.replace(/Component$/, 'Blueprint')) ?? null;
}

/** WTS-Nachricht für den Trade-Chat (max. 180 Zeichen). */
const wtsMessage = (name, qty, price) => `WTS [${name}]${qty > 1 ? ` x${qty}` : ''} ${price}p`;

function SellBox(props) {
  const owned = () => (props.item.gameRef && game.inventory?.counts?.[props.item.gameRef]) || 0;
  const [qty, setQty] = createSignal(1);
  const [plat, setPlat] = createSignal(null);
  const [copied, setCopied] = createSignal(false);
  const value = () => plat() ?? props.price?.wts ?? '';
  const n = () => Math.min(Math.max(1, qty()), owned());
  const copy = async () => {
    await copyToClipboard(wtsMessage(props.item.name, n(), Number(value()) || 1));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Show when={owned() > 0}>
      <div class="sell-box">
        <h4>{t('Verkaufen')}</h4>
        <div class="sell-row">
          <label>
            <span>{t('Menge')}</span>
            <input type="number" min="1" max={owned()} value={n()} onInput={(e) => setQty(Math.round(Number(e.currentTarget.value) || 1))} />
            <small class="muted">/ {owned()}</small>
          </label>
          <label>
            <span>{t('Preis')}</span>
            <input type="number" min="1" value={value()} placeholder="–" onInput={(e) => setPlat(Math.max(1, Math.round(Number(e.currentTarget.value) || 0)))} />
            <Plat />
          </label>
          <button class="btn btn-primary" onClick={copy} disabled={!value()}>
            {copied() ? <Check size={14} /> : <Copy size={14} />} {t('WTS-Nachricht kopieren')}
          </button>
          <button class="btn" onClick={() => openExternal(`https://warframe.market/items/${props.item.slug}`)}>
            {t('Auf warframe.market einstellen')} <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </Show>
  );
}

function PriceTags(props) {
  const [item] = createResource(
    () => props.marketItem ?? props.gameId ?? null,
    async (key) => (typeof key === 'string' ? marketItemFor(key) : key),
  );
  const [loaded] = createResource(item, (m) => loadPrice(m.slug).catch(() => null));
  const price = () => (item() ? cachedPrice(item().slug) : null);
  return (
    <Show when={!item.loading} fallback={<p class="muted small">…</p>}>
      <Show when={item()} fallback={<p class="muted small">{t('Nicht auf warframe.market handelbar.')}</p>}>
        <div class="detail-prices">
          <span class="price wts">
            SELL <b>{price() ? price().wts ?? '–' : loaded.loading ? '…' : '–'}</b> <Plat />
          </span>
          <span class="price wtb">
            BUY <b>{price() ? price().wtb ?? '–' : loaded.loading ? '…' : '–'}</b> <Plat />
          </span>
          <button class="icon-btn" title={t('Auf warframe.market')} onClick={() => openExternal(`https://warframe.market/items/${item().slug}`)}>
            <ExternalLink size={15} />
          </button>
          <PriceAlertButton item={item()} price={price()} />
        </div>
        <SellBox item={item()} price={price()} />
      </Show>
    </Show>
  );
}

function Drops(props) {
  return (
    <Show when={props.drops?.length} fallback={<div class="drops-empty">{t('Keine Fundorte bekannt (Markt, Clan-Dojo, Händler oder Quest).')}</div>}>
      <table class="drops">
        <thead>
          <tr>
            <th>{t('Fundort')}</th>
            <th>{t('Seltenheit')}</th>
            <th>{t('Chance')}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.drops}>
            {(d) => (
              <tr>
                <td>{d.location}</td>
                <td class="muted">{d.rarity ?? ''}</td>
                <td class="num">{d.chance != null ? `${d.chance} %` : ''}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

function MasteryDetails(props) {
  const item = props.item;
  const row = createMemo(() => evaluate(item, game.inventory));
  const entries = () => [{ id: item.id, name: item.name, image: item.image, isSet: true, count: 1 }, ...row().parts];
  const first = entries().some((e) => e.id === props.partId) ? props.partId : row().parts.find((p) => p.built + p.bp < p.count)?.id ?? item.id;
  const [selectedId, setSelectedId] = createSignal(first);
  const sel = () => entries().find((e) => e.id === selectedId()) ?? entries()[0];
  const selWiki = () => (sel().isSet || sel().id.includes('/Recipes/') ? (item.wiki ? `${item.wiki}#Acquisition` : wikiFor(item.name)) : wikiFor(sel().name));

  return (
    <>
      <div class="detail-top">
        <div class="detail-img">
          <Show when={item.image}>
            <img src={item.image} alt="" />
          </Show>
        </div>
        <div class="detail-info">
          <div class="detail-title">
            <h2>
              {item.name} <TodoStar id={item.id} size={20} />
            </h2>
            <span class="detail-title-actions">
              <button class="btn btn-outline" onClick={() => openBuilds(item.name)} title={t('Builds von overframe.gg für dieses Item')}>
                <Wrench size={13} /> Builds
              </button>
              <button class="btn btn-outline" onClick={() => openExternal(item.wiki ?? wikiFor(item.name))}>
                {t('Wiki-Link')} <ExternalLink size={13} />
              </button>
            </span>
          </div>
          <div class="detail-boxes">
            <dl class="facts">
              <dt>{t('Kategorie')}</dt>
              <dd>{t(item.category)}</dd>
              <dt>{t('Mastery-Rang')}</dt>
              <dd>MR {item.masteryReq}</dd>
              <dt>{t('Status')}</dt>
              <dd class={`status-text ${row().status}`}>
                {t(STATUS_LABEL[row().status])}
                {row().status === 'leveling' ? ` · ${t('Rang {a}/{b}', { a: row().rank, b: item.maxRank })}` : ''}
              </dd>
              <Show when={item.vaulted != null}>
                <dt>Vaulted</dt>
                <dd>
                  {item.vaulted ? (
                    <span class="tag tag-vault">
                      <Lock size={11} /> {t('Ja')}
                    </span>
                  ) : (
                    t('Nein')
                  )}
                </dd>
              </Show>
            </dl>
            <div class="build-box">
              <h4>{t('Zum Bauen')}</h4>
              <ul class="res-list">
                <li class={row().creditsOk ? 'ok' : 'bad'}>
                  <Coins size={14} /> Credits <span>{compact(item.credits)}</span>
                </li>
                <For each={row().resources}>
                  {(r) => (
                    <li class={`${r.built >= r.count ? 'ok' : 'bad'} bn-click`} onClick={materialClick(r)} title={t('Klick: wie farme ich das?')}>
                      <Show when={r.image}>
                        <img src={r.image} alt="" />
                      </Show>{' '}
                      {r.name}
                      <span>
                        {compact(r.built)}/{compact(r.count)}
                      </span>
                    </li>
                  )}
                </For>
                <Show when={row().resources.length === 0}>
                  <li class="muted">{t('Keine Rohstoffe nötig.')}</li>
                </Show>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-bottom">
        <div class="components">
          <h3>{t('Bauteile')}</h3>
          <ul>
            <For each={entries()}>
              {(e) => {
                const ok = () => (e.isSet ? row().owned : e.built >= e.count);
                const bpOnly = () => !e.isSet && !ok() && e.built + e.bp >= e.count;
                return (
                  <li>
                    <button classList={{ active: e.id === sel().id, ok: ok(), bp: bpOnly() }} onClick={() => setSelectedId(e.id)}>
                      <span class="comp-img">
                        <Show when={e.image}>
                          <img src={e.image} alt="" />
                        </Show>
                      </span>
                      <span class="comp-name">{e.isSet ? `${item.name} (Set)` : e.name}</span>
                      <Show when={!e.isSet}>
                        <span class="comp-count" title={bpOnly() ? t('Nur als Blaupause – muss noch gebaut werden') : ''}>
                          <Show when={ok()}>
                            <Check size={12} />
                          </Show>
                          {Math.min(e.built + e.bp, e.count)}/{e.count}
                          {bpOnly() ? ' BP' : ''}
                        </span>
                      </Show>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
        <div class="component-detail">
          <div class="component-head">
            <div class="comp-big">
              <Show when={sel().image}>
                <img src={sel().image} alt="" />
              </Show>
            </div>
            <div>
              <h3>{sel().isSet ? `${item.name} (Set)` : `${item.name} – ${sel().name}`}</h3>
              <Show when={sel().ducats != null}>
                <p class="muted">
                  <Ducat /> {t('{n} Ducats', { n: sel().ducats })}
                </p>
              </Show>
              <Show when={sel().id} keyed>
                {(id) => <PriceTags gameId={id} />}
              </Show>
              <button class="btn btn-outline small-btn" onClick={() => openExternal(selWiki())}>
                {t('Wie farme ich das? (Wiki)')} <ExternalLink size={13} />
              </button>
            </div>
          </div>
          <h4>{t('Fundorte')}</h4>
          <Show when={!sel().isSet} fallback={<div class="drops-empty">{t('Wähle links ein Bauteil, um seine Fundorte zu sehen.')}</div>}>
            <Drops drops={sel().drops} />
          </Show>
        </div>
      </div>
    </>
  );
}

function MarketDetails(props) {
  const m = props.marketItem;
  return (
    <div class="detail-top">
      <div class="detail-img">
        <Show when={m.thumb}>
          <img src={m.thumb.replace('/thumbs/', '/').replace(/\.128x128\.png$/, '.png')} alt="" onError={(e) => (e.currentTarget.src = m.thumb)} />
        </Show>
      </div>
      <div class="detail-info">
        <div class="detail-title">
          <h2>{m.name}</h2>
          <button class="btn btn-outline" onClick={() => openExternal(wikiFor(m.name))}>
            {t('Wiki-Link')} <ExternalLink size={13} />
          </button>
        </div>
        <dl class="facts">
          <Show when={props.qty != null}>
            <dt>{t('Im Besitz')}</dt>
            <dd>x{props.qty}</dd>
          </Show>
          <Show when={m.ducats != null}>
            <dt>Ducats</dt>
            <dd>
              <Ducat /> {m.ducats}
            </dd>
          </Show>
          <dt>Tags</dt>
          <dd class="muted">{m.tags.join(', ')}</dd>
        </dl>
        <PriceTags marketItem={m} />
      </div>
    </div>
  );
}

export default function ItemDetails(props) {
  const onKey = (e) => e.key === 'Escape' && props.onClose();
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal details" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3>{t('Item-Details')}</h3>
          <button class="icon-btn" onClick={props.onClose} aria-label={t('Schließen')}>
            <X size={20} />
          </button>
        </div>
        <Show when={props.item} keyed fallback={<MarketDetails marketItem={props.marketItem} qty={props.qty} />}>
          {(item) => <MasteryDetails item={item} partId={props.partId} />}
        </Show>
      </div>
    </div>
  );
}

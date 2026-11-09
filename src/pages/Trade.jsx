// Handel: übrige Prime-Teile für Baro (Ducats pro Platin) und Verkaufs-Helfer mit WTS-Nachrichten.
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Bell, Coins, HandCoins, Search, ArrowDownUp, Copy, Check, Infinity as All, Gem, Package, Puzzle, Sparkles, RefreshCw } from 'lucide-solid';
import { getItems, cachedPrice, loadPrice } from '../lib/market.js';
import { loadMasteryDb, loadBulkPrices } from '../lib/gamedb.js';
import { game } from '../lib/game.js';
import { world, countdown, now } from '../lib/world.js';
import { spareParts, spareSets, wtsMessages, copyToClipboard, CHAT_LIMIT } from '../lib/trade.js';
import { load, save } from '../lib/ipc.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import { t } from '../lib/i18n.js';
import PriceAlerts from './PriceAlerts.jsx';
import { alerts } from '../lib/priceAlerts.js';
import './trade.css';

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

function useTradeData() {
  const [db] = createResource(() => loadMasteryDb());
  const [market] = createResource(() => getItems().then((items) => ({ items, byRef: new Map(items.filter((i) => i.gameRef).map((i) => [i.gameRef, i])) })));
  const [bulk] = createResource(() => loadBulkPrices().catch(() => ({})));
  const parts = createMemo(() => {
    if (!db() || !game.inventory) return [];
    const m = market();
    const b = bulk() ?? {};
    return spareParts(db(), game.inventory).map((e) => {
      const mi = m?.byRef.get(e.id) ?? m?.byRef.get(e.id.replace(/Component$/, 'Blueprint')) ?? null;
      const name = mi?.name ?? `${e.items[0].name} ${e.part.name}`;
      return { ...e, m: mi, name, plat: b[name.toLowerCase()] || null, image: mi?.thumb ?? e.part.image };
    });
  });
  return { db, market, bulk, parts, error: () => db.error?.message ?? market.error?.message };
}

export default function Trade() {
  const [tab, setTab] = createSignal(load('cm.trade.tab', 'ducats'));
  const data = useTradeData();
  const pick = (id) => {
    setTab(id);
    save('cm.trade.tab', id);
  };
  return (
    <div class="page">
      <div class="page-tabs">
        <button classList={{ active: tab() === 'ducats' }} onClick={() => pick('ducats')}>
          <Coins size={16} /> {t('Ducats für Baro')}
        </button>
        <button classList={{ active: tab() === 'sell' }} onClick={() => pick('sell')}>
          <HandCoins size={16} /> {t('Verkaufen')}
        </button>
        <button classList={{ active: tab() === 'alerts' }} onClick={() => pick('alerts')}>
          <Bell size={16} /> {t('Preis-Alarme')}{' '}
          <Show when={alerts().length > 0}>
            <span class="count">{alerts().length}</span>
          </Show>
        </button>
      </div>
      <Switch>
        <Match when={tab() === 'alerts'}>
          <PriceAlerts />
        </Match>
        <Match when={data.error()}>
          <div class="empty">{data.error()}</div>
        </Match>
        <Match when={!game.inventory}>
          <div class="empty">{t('Noch kein Inventar – synchronisiere zuerst mit dem Spiel.')}</div>
        </Match>
        <Match when={!data.db() || !data.market()}>
          <div class="empty">{t('Lade Daten …')}</div>
        </Match>
        <Match when={tab() === 'ducats'}>
          <DucatTab data={data} />
        </Match>
        <Match when={true}>
          <SellTab data={data} />
        </Match>
      </Switch>
    </div>
  );
}

// ---------- Reiter 1: Ducat-Rechner ----------
function BaroInfo() {
  return (
    <Show when={world.baro}>
      {(b) => (
        <span class="trd-baro">
          {new Date(b().activation).getTime() <= now()
            ? t('Baro ist da ({place}) – geht in {t}', { place: b().location ?? '', t: countdown(b().expiry) })
            : t('Baro kommt in {t}', { t: countdown(b().activation) })}
        </span>
      )}
    </Show>
  );
}

function DucatTab(props) {
  const [query, setQuery] = createSignal('');
  const rows = createMemo(() =>
    props.data
      .parts()
      .map((p) => ({ ...p, ratio: p.plat ? p.ducats / p.plat : null }))
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.ducats - a.ducats || a.name.localeCompare(b.name)),
  );
  const shown = () => {
    const q = query().trim().toLowerCase();
    return q ? rows().filter((r) => r.name.toLowerCase().includes(q)) : rows();
  };
  const total = () => rows().reduce((s, r) => s + r.ducats * r.spare, 0);
  const totalPlat = () => rows().reduce((s, r) => s + (r.plat ?? 0) * r.spare, 0);
  return (
    <>
      <div class="toolbar">
        <BaroInfo />
        <div class="toolbar-right">
          <label class="search">
            <Search size={15} />
            <input value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder={t('Suchen')} />
          </label>
        </div>
      </div>
      <p class="muted small trd-hint">
        {t('Nur Prime-Teile, die kein noch nicht gebautes Item mehr braucht (gemeistert oder schon gebaut). Gebaute Warframe-Bauteile zählen nicht – Baro nimmt nur Blaupausen.')}
      </p>
      <Show when={rows().length} fallback={<div class="empty">{t('Keine übrigen Prime-Teile gefunden.')}</div>}>
        <div class="trd-table-wrap">
          <table class="trd-table">
            <thead>
              <tr>
                <th>{t('Teil')}</th>
                <th class="num">{t('Übrig')}</th>
                <th class="num">Ducats</th>
                <th class="num">{t('Ø Platin')}</th>
                <th class="num" title={t('Ducats pro Platin Marktwert')}>
                  {t('Ducats/Platin')}
                </th>
                <th class="num">{t('Summe')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={shown()}>
                {(r) => (
                  <tr classList={{ 'trd-good': r.ratio != null && r.ratio >= 10 }}>
                    <td>
                      <span class="trd-name">
                        <Show when={r.image}>
                          <img src={r.image} alt="" loading="lazy" />
                        </Show>
                        {r.name}
                      </span>
                    </td>
                    <td class="num">{r.spare}</td>
                    <td class="num">
                      {r.ducats} <Ducat size={12} />
                    </td>
                    <td class="num">
                      {r.plat != null ? (
                        <>
                          {r.plat.toFixed(1)} <Plat size={12} />
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td class="num">{r.ratio != null ? r.ratio.toFixed(1) : '–'}</td>
                    <td class="num">
                      {fmt(r.ducats * r.spare)} <Ducat size={12} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <div class="totals">
        <span title={t('Übrige Teile')}>{rows().reduce((s, r) => s + r.spare, 0)}×</span>
        <span title={t('Ducats zum Opfern')}>
          {fmt(total())} <Ducat />
        </span>
        <span title={t('Marktwert (Durchschnitt)')}>
          {fmt(totalPlat())} <Plat />
        </span>
      </div>
    </>
  );
}

// ---------- Reiter 2: Verkaufs-Helfer ----------
const KINDS = [
  { id: 'all', label: 'Alle', icon: All },
  { id: 'part', label: 'Prime-Teile', icon: Gem },
  { id: 'set', label: 'Sets', icon: Package },
  { id: 'mod', label: 'Mods', icon: Puzzle },
  { id: 'arcane', label: 'Arcanes', icon: Sparkles },
];
const SORTS = {
  value: { label: 'Gesamtwert', fn: (a, b) => (b.price ?? -1) * b.qty - (a.price ?? -1) * a.qty },
  price: { label: 'Preis', fn: (a, b) => (b.price ?? -1) - (a.price ?? -1) },
  name: { label: 'Name', fn: (a, b) => a.name.localeCompare(b.name) },
};

function SellTab(props) {
  const [keep, setKeep] = createSignal(load('cm.trade.keep.v1', 1));
  const [kind, setKind] = createSignal('all');
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal('value');
  const [selected, setSelected] = createSignal(new Set());
  const [edits, setEdits] = createSignal({});
  const [msgs, setMsgs] = createSignal(null);
  const [copied, setCopied] = createSignal(null);
  const [loading, setLoading] = createSignal(null);
  const [sortTick, setSortTick] = createSignal(0);

  // Sets zuerst aus den übrigen Teilen bilden, der Rest wird einzeln verkauft
  const base = createMemo(() => {
    const db = props.data.db();
    const market = props.data.market();
    const bulk = props.data.bulk() ?? {};
    const inv = game.inventory;
    const parts = props.data.parts();
    const spare = new Map(parts.map((p) => [p.id, p.spare]));
    const out = [];
    for (const { item, count } of spareSets(db, spare)) {
      const m = market.byRef.get(item.id);
      if (m) out.push({ key: m.slug, kind: 'set', name: m.name, slug: m.slug, image: m.thumb, qty: count, avg: bulk[m.name.toLowerCase()] || null });
    }
    for (const p of parts) {
      const qty = spare.get(p.id);
      if (p.m && qty >= 1) out.push({ key: p.m.slug, kind: 'part', name: p.name, slug: p.m.slug, image: p.image, qty, avg: p.plat });
    }
    for (const m of market.items) {
      const isMod = m.tags.includes('mod');
      const isArcane = m.tags.includes('arcane_enhancement');
      if ((!isMod && !isArcane) || !m.gameRef) continue;
      const qty = (inv.counts[m.gameRef] ?? 0) - keep();
      if (qty > 0) out.push({ key: m.slug, kind: isMod ? 'mod' : 'arcane', name: m.name, slug: m.slug, image: m.thumb, qty, avg: null });
    }
    return out;
  });

  // Mods/Arcanes haben keinen Sammelpreis: nacheinander laden (Rust-Warteschlange, 15 Min. Cache)
  createEffect(
    on(base, (list) => {
      let alive = true;
      onCleanup(() => {
        alive = false;
        setLoading(null);
      });
      const todo = list.filter((r) => r.avg == null && !cachedPrice(r.slug));
      if (!todo.length) return;
      (async () => {
        setLoading({ done: 0, total: todo.length });
        for (let i = 0; i < todo.length && alive; i++) {
          await loadPrice(todo[i].slug).catch(() => {});
          if (alive) setLoading({ done: i + 1, total: todo.length });
        }
        if (alive) {
          setLoading(null);
          setSortTick((n) => n + 1);
        }
      })();
    }),
  );

  const rows = createMemo(() =>
    base().map((r) => {
      const mkt = r.avg ?? cachedPrice(r.slug)?.wts ?? null;
      const price = edits()[r.key] ?? (mkt != null ? Math.max(1, Math.round(mkt)) : null);
      return { ...r, market: mkt, price };
    }),
  );
  // Reihenfolge erst neu bilden, wenn alle Preise da sind – sonst springen die Zeilen beim Nachladen
  const order = createMemo(
    on([base, sort, sortTick], () => new Map([...rows()].sort(SORTS[sort()].fn).map((r, i) => [r.key, i]))),
  );
  const shown = () => {
    const q = query().trim().toLowerCase();
    return rows()
      .filter((r) => kind() === 'all' || r.kind === kind())
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => (order().get(a.key) ?? 0) - (order().get(b.key) ?? 0));
  };
  const toggle = (key) => {
    const next = new Set(selected());
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  };
  const allShown = () => shown().length > 0 && shown().every((r) => selected().has(r.key));
  const toggleAll = () => {
    const next = new Set(selected());
    const all = allShown();
    for (const r of shown()) all ? next.delete(r.key) : next.add(r.key);
    setSelected(next);
  };
  const chosen = () => rows().filter((r) => selected().has(r.key) && r.price != null).sort(SORTS.price.fn);
  const sum = () => chosen().reduce((s, r) => s + r.price * r.qty, 0);
  const copy = async (text, i) => {
    await copyToClipboard(text).catch(() => {});
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
  };
  const makeWts = () => {
    const list = wtsMessages(chosen());
    setMsgs(list);
    if (list.length) copy(list[0], 0);
  };

  return (
    <>
      <div class="toolbar">
        <div class="filter-pills">
          <For each={KINDS}>
            {(k) => (
              <button classList={{ active: kind() === k.id }} onClick={() => setKind(k.id)} title={t(k.label)}>
                <Dynamic component={k.icon} size={16} />
                <Show when={kind() === k.id}>
                  <span>{t(k.label)}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <Show when={loading()}>
          <span class="muted small trd-loading">
            <RefreshCw size={13} class="spin" /> {t('Preise {a}/{b}', { a: loading().done, b: loading().total })}
          </span>
        </Show>
        <div class="toolbar-right">
          <label class="trd-keep" title={t('So viele Exemplare jeder Mod/jedes Arcanes behältst du')}>
            {t('Behalten')}
            <input
              type="number"
              min="0"
              max="99"
              value={keep()}
              onChange={(e) => {
                const v = Math.max(0, Math.min(99, Number(e.currentTarget.value) || 0));
                setKeep(v);
                save('cm.trade.keep.v1', v);
              }}
            />
          </label>
          <label class="search">
            <Search size={15} />
            <input value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder={t('Suchen')} />
          </label>
          <label class="select">
            <ArrowDownUp size={15} />
            <select value={sort()} onChange={(e) => setSort(e.currentTarget.value)}>
              <For each={Object.entries(SORTS)}>{([id, s]) => <option value={id}>{t(s.label)}</option>}</For>
            </select>
          </label>
        </div>
      </div>
      <Show when={shown().length} fallback={<div class="empty">{t('Nichts zum Verkaufen gefunden.')}</div>}>
        <div class="trd-table-wrap">
          <table class="trd-table trd-sell">
            <thead>
              <tr>
                <th class="chk">
                  <input type="checkbox" checked={allShown()} onChange={toggleAll} title={t('Alle auswählen')} />
                </th>
                <th>Item</th>
                <th class="num">{t('Menge')}</th>
                <th class="num">{t('Marktpreis')}</th>
                <th class="num">{t('Dein Preis')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={shown()}>
                {(r) => (
                  <tr classList={{ sel: selected().has(r.key) }} onClick={() => toggle(r.key)}>
                    <td class="chk">
                      <input type="checkbox" checked={selected().has(r.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.key)} />
                    </td>
                    <td>
                      <span class="trd-name">
                        <Show when={r.image}>
                          <img src={r.image} alt="" loading="lazy" />
                        </Show>
                        {r.name}
                        <Show when={r.kind === 'set'}>
                          <small class="trd-tag">Set</small>
                        </Show>
                      </span>
                    </td>
                    <td class="num">{r.qty}</td>
                    <td class="num">
                      {r.market != null ? (
                        <>
                          {r.avg != null ? r.market.toFixed(1) : r.market} <Plat size={12} />
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td class="num" onClick={(e) => e.stopPropagation()}>
                      <input
                        class="trd-price"
                        type="number"
                        min="1"
                        value={r.price ?? ''}
                        placeholder="–"
                        onChange={(e) => {
                          const v = Math.max(1, Math.round(Number(e.currentTarget.value) || 0));
                          setEdits((x) => ({ ...x, [r.key]: v }));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={msgs()}>
        <div class="trd-msgs">
          <Show when={msgs().length > 1}>
            <p class="muted small">{t('Zu lang für eine Chat-Zeile – aufgeteilt in {n} Nachrichten:', { n: msgs().length })}</p>
          </Show>
          <For each={msgs()}>
            {(m, i) => (
              <div class="trd-msg">
                <code>{m}</code>
                <small class="muted">
                  {m.length}/{CHAT_LIMIT}
                </small>
                <button class="btn" onClick={() => copy(m, i())} title={t('Kopieren')}>
                  {copied() === i() ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="totals trd-sellbar">
        <span>{t('{n} ausgewählt', { n: chosen().length })}</span>
        <span>
          {fmt(sum())} <Plat />
        </span>
        <button class="btn btn-primary" disabled={!chosen().length} onClick={makeWts}>
          <Copy size={14} /> {t('WTS-Nachricht kopieren')}
        </button>
      </div>
    </>
  );
}

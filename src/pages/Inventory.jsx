// Inventar: handelbare Items aus dem letzten Sync mit Marktpreisen.
// Mengen kommen nur aus dem Sync mit dem Spiel – von Hand verstellen geht nicht.
import { createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Infinity as All, Gem, Puzzle, Flame, Sparkles, Box, Search, ArrowDownUp, RefreshCw, FileUp, X, ExternalLink } from 'lucide-solid';
import { getItems, cachedPrice, loadPrice } from '../lib/market.js';
import { game, syncGame, importInventory } from '../lib/game.js';
import ItemCard from '../components/ItemCard.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import { loadMasteryDb } from '../lib/gamedb.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import { t, num } from '../lib/i18n.js';
import { isTauri, load, openExternal, save } from '../lib/ipc.js';

const PAGE = 60;

const FILTERS = [
  { id: 'all', label: 'Alle', icon: All, test: () => true },
  { id: 'prime', label: 'Prime-Teile', icon: Gem, test: (tg) => tg.includes('prime') && !tg.includes('set') && !tg.includes('mod') },
  { id: 'mod', label: 'Mods', icon: Puzzle, test: (tg) => tg.includes('mod') },
  { id: 'relic', label: 'Relikte', icon: Flame, test: (tg) => tg.includes('relic') },
  { id: 'arcane', label: 'Arcanes', icon: Sparkles, test: (tg) => tg.includes('arcane_enhancement') },
  { id: 'misc', label: 'Sonstiges', icon: Box, test: (tg) => !['prime', 'mod', 'relic', 'arcane_enhancement'].some((x) => tg.includes(x)) },
];

const wts = (r) => cachedPrice(r.item.slug)?.wts;
const SORTS = {
  name: { label: 'Name', fn: (a, b) => a.item.name.localeCompare(b.item.name) },
  wts: { label: 'Preis (WTS)', fn: (a, b) => (wts(b) ?? -1) - (wts(a) ?? -1) },
  total: { label: 'Gesamtwert', fn: (a, b) => (wts(b) ?? 0) * b.qty - (wts(a) ?? 0) * a.qty },
  ducats: { label: 'Ducats', fn: (a, b) => (b.item.ducats ?? -1) - (a.item.ducats ?? -1) },
  qty: { label: 'Menge', fn: (a, b) => b.qty - a.qty },
};

export default function Inventory() {
  const [items] = createResource(() => getItems());
  const [filter, setFilter] = createSignal(load('cm.inv.filter', 'all'));
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal(load('cm.inv.sort', 'name'));
  const [limit, setLimit] = createSignal(PAGE);
  const [details, setDetails] = createSignal(null);
  // Prime-Teile & Co. öffnen die Bauplan-Ansicht ihres Items, Mods/Relikte die Markt-Ansicht
  const openDetails = async (r) => {
    const db = await loadMasteryDb().catch(() => null);
    setDetails({ ...r, entry: r.item.gameRef ? db?.index.get(r.item.gameRef) : null });
  };

  // Alle Items aus dem Inventar mit warframe.market-Eintrag (ohne Sets)
  const rows = createMemo(() => {
    const list = items();
    const counts = game.inventory?.counts;
    if (!list || !counts) return [];
    const out = [];
    for (const item of list) {
      if (item.tags.includes('set')) continue;
      const qty = (item.gameRef && counts[item.gameRef]) || 0;
      if (qty > 0) out.push({ item, qty });
    }
    return out;
  });

  const shown = createMemo(() => {
    const f = FILTERS.find((x) => x.id === filter()) ?? FILTERS[0];
    const q = query().trim().toLowerCase();
    return rows()
      .filter((r) => f.test(r.item.tags))
      .filter((r) => !q || r.item.name.toLowerCase().includes(q))
      .sort(SORTS[sort()]?.fn ?? SORTS.name.fn);
  });

  const totals = createMemo(() => {
    let plat = 0;
    let ducats = 0;
    let priced = 0;
    for (const r of shown()) {
      const p = wts(r);
      if (p != null) {
        plat += p * r.qty;
        priced++;
      }
      ducats += (r.item.ducats ?? 0) * r.qty;
    }
    return { plat, ducats, priced };
  });

  const pick = (fn, key) => (v) => {
    fn(v);
    save(key, v);
    setLimit(PAGE);
  };

  return (
    <Switch>
      <Match when={!isTauri}>
        <div class="empty">{t('Nur in der Desktop-App verfügbar')}</div>
      </Match>
      <Match when={items.error}>
        <div class="empty">{t('warframe.market nicht erreichbar: {e}', { e: items.error?.message ?? '' })}</div>
      </Match>
      <Match when={items.loading}>
        <div class="empty">{t('Lade Item-Liste von warframe.market …')}</div>
      </Match>
      <Match when={items()}>
        <div class="page">
          <div class="toolbar">
            <div class="filter-pills">
              <For each={FILTERS}>
                {(f) => (
                  <button classList={{ active: filter() === f.id }} onClick={() => pick(setFilter, 'cm.inv.filter')(f.id)} title={t(f.label)}>
                    <Dynamic component={f.icon} size={16} />
                    <Show when={filter() === f.id}>
                      <span>{t(f.label)}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div class="toolbar-right">
              <label class="search">
                <Search size={15} />
                <input
                  value={query()}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setLimit(PAGE);
                  }}
                  placeholder={t('Suchen')}
                />
              </label>
              <label class="select">
                <ArrowDownUp size={15} />
                <select value={sort()} onChange={(e) => pick(setSort, 'cm.inv.sort')(e.currentTarget.value)}>
                  <For each={Object.entries(SORTS)}>{([id, s]) => <option value={id}>{t(s.label)}</option>}</For>
                </select>
              </label>
            </div>
          </div>

          <Show
            when={rows().length > 0}
            fallback={
              <div class="empty">
                <h2>{t('Noch keine Items')}</h2>
                <p>
                  {t('Starte Warframe, logge dich ein und klicke auf')} <b>{t('Mit Spiel synchronisieren')}</b>.{' '}
                  {t('Cephalon Merlin liest dann dein Inventar – genau wie AlecaFrame.')}
                </p>
                <Show when={game.error}>
                  <p class="err">{t(game.error)}</p>
                </Show>
                <div class="empty-actions">
                  <button class="btn btn-primary" onClick={syncGame} disabled={game.syncing}>
                    <RefreshCw size={15} class={game.syncing ? 'spin' : ''} /> {t('Mit Spiel synchronisieren')}
                  </button>
                  <button class="btn" onClick={importInventory}>
                    <FileUp size={15} /> {t('inventory.json importieren')}
                  </button>
                </div>
              </div>
            }
          >
            <div class="card-grid two">
              <For each={shown().slice(0, limit())}>
                {(r) => <ItemCard item={r.item} qty={r.qty} onOpen={() => openDetails(r)} />}
              </For>
            </div>
            <Show when={shown().length > limit()}>
              <button class="btn more" onClick={() => setLimit((l) => l + PAGE)}>
                {t('Mehr anzeigen ({n} weitere)', { n: shown().length - limit() })}
              </button>
            </Show>
            <Show when={shown().length === 0}>
              <div class="empty">{t('Keine Treffer.')}</div>
            </Show>
          </Show>

          <div class="totals">
            <span title={t('Preise geladen für {a} von {b} Items', { a: totals().priced, b: shown().length })}>
              {num(totals().plat)} <Plat />
            </span>
            <span>
              {num(totals().ducats)} <Ducat />
            </span>
          </div>

          <Show when={details()}>
            <ItemDetails item={details().entry?.item} partId={details().entry?.part?.id} marketItem={details().item} qty={details().qty} onClose={() => setDetails(null)} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

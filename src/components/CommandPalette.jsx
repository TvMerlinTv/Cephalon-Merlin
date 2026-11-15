// Globale Suche (Strg+K): Seiten, Aktionen, Items aus der Item-Datenbank und von warframe.market.
// Pfeiltasten wählen, Enter öffnet, Esc schließt.
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { Search, Settings, RefreshCw, Package, Store } from 'lucide-solid';
import { NAV } from './Sidebar.jsx';
import { loadMasteryDb } from '../lib/gamedb.js';
import { getItems } from '../lib/market.js';
import { searchList } from '../lib/search.js';
import { syncGame } from '../lib/game.js';
import { onEscape } from '../lib/keys.js';
import { t } from '../lib/i18n.js';

export default function CommandPalette(props) {
  onEscape(() => props.onClose());
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  const [db] = createResource(() => loadMasteryDb().catch(() => null));
  const [market] = createResource(() => getItems().catch(() => []));
  let input;
  let listEl;
  onMount(() => input.focus());

  const commands = () => [
    ...NAV.map((n) => ({ group: 'Seiten', name: t(n.label), icon: n.icon, run: () => props.onNavigate(n.id) })),
    { group: 'Seiten', name: t('Einstellungen'), icon: Settings, run: () => props.onNavigate('settings') },
    { group: 'Aktionen', name: t('Mit Spiel synchronisieren'), icon: RefreshCw, run: () => syncGame() },
  ];

  const results = createMemo(() => {
    const q = query().trim();
    if (!q) return commands();
    const out = searchList(commands(), q, 5);
    const items = searchList(db()?.items ?? [], q, 7);
    const names = new Set(items.map((i) => i.name));
    for (const item of items) out.push({ group: 'Items', name: item.name, image: item.image, icon: Package, run: () => props.onItem({ item }) });
    const rest = (market() ?? []).filter((m) => !names.has(m.name));
    for (const m of searchList(rest, q, 7)) out.push({ group: 'Warframe Market', name: m.name, image: m.thumb, icon: Store, run: () => props.onItem({ marketItem: m }) });
    return out;
  });

  createEffect(() => {
    results();
    setActive(0);
  });
  const choose = (r) => {
    // erst ausführen, dann schließen: nach dem Schließen ist dieses Fenster (und seine props) abgebaut
    r.run();
    props.onClose();
  };
  const onKey = (e) => {
    const n = results().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      queueMicrotask(() => listEl?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      choose(results()[active()]);
    }
  };

  return (
    <Portal>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="modal palette" onClick={(e) => e.stopPropagation()}>
          <label class="search big">
            <Search size={17} />
            <input
              ref={input}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKey}
              placeholder={t('Seite, Item oder Aktion suchen …')}
              aria-label={t('Suchen')}
            />
            <kbd>Esc</kbd>
          </label>
          <ul class="palette-list" ref={listEl} role="listbox">
            <For each={results()}>
              {(r, i) => (
                <>
                  <Show when={i() === 0 || results()[i() - 1].group !== r.group}>
                    <li class="palette-group">{t(r.group)}</li>
                  </Show>
                  <li>
                    <button classList={{ active: active() === i() }} onMouseMove={() => setActive(i())} onClick={() => choose(r)} role="option" aria-selected={active() === i()}>
                      {r.image ? <img src={r.image} alt="" loading="lazy" /> : <Dynamic component={r.icon} size={18} />}
                      <span>{r.name}</span>
                    </button>
                  </li>
                </>
              )}
            </For>
            <Show when={!results().length}>
              <li class="palette-empty muted">{db.loading || market.loading ? t('Lade Daten …') : t('Nichts gefunden.')}</li>
            </Show>
          </ul>
          <div class="palette-foot muted small">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> {t('wählen')}
            </span>
            <span>
              <kbd>Enter</kbd> {t('öffnen')}
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// To-Do → Relikte: eigene Relikte mit fehlenden Teilen der To-Do-Items, darunter Teile ohne passendes Relikt.
// Zweite Ansicht "Volle Sets": Prime-Items, bei denen jedes Teil aus Relikten kommt, die du besitzt.
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from 'solid-js';
import { Archive, PackageX, Star, Layers, BadgeCheck } from 'lucide-solid';
import { loadMasteryDb, loadRelicDb, loadBulkPrices, rarityOf, evaluate, builtCount, blueprintOnlyCount } from '../lib/gamedb.js';
import { RelicIcon } from './WorldWidgets.jsx';
import { Plat } from './Icons.jsx';
import TodoStar from './TodoStar.jsx';
import { load, save } from '../lib/ipc.js';
import { t } from '../lib/i18n.js';

const REFINEMENTS = ['radiant', 'flawless', 'exceptional', 'intact'];
const REF_SHORT = { intact: 'I', exceptional: 'E', flawless: 'F', radiant: 'R' };
const REF_DE = { intact: 'Intakt', exceptional: 'Außergewöhnlich', flawless: 'Makellos', radiant: 'Strahlend' };

function FullSets(props) {
  const [prices] = createResource(() => loadBulkPrices().catch(() => ({})));
  const [view, setView] = createSignal(load('cm.fullsets.view.v1', { filter: 'all', sort: 'price' }));
  const setV = (patch) => {
    const next = { ...view(), ...patch };
    setView(next);
    save('cm.fullsets.view.v1', next);
  };
  const sets = createMemo(() => {
    const { relicDb, mastery } = props;
    const inv = props.inv;
    const drops = new Map();
    const fromAnyRelic = new Set();
    for (const relic of relicDb.relics) {
      const counts = inv?.relics?.[relic.id] ?? {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const best = REFINEMENTS.find((r) => counts[r] > 0) ?? 'intact';
      for (const w of relic.rewards[best] ?? relic.rewards.intact ?? []) {
        const entry = w.id ? mastery.index.get(w.id) : null;
        if (!entry?.part) continue;
        const key = `${entry.item.id}|${entry.part.id}`;
        fromAnyRelic.add(entry.item.id);
        if (!total) continue;
        if (!drops.has(key)) drops.set(key, []);
        drops.get(key).push({ relic, best, total, chance: w.chance });
      }
    }
    const p = prices() ?? {};
    const out = [];
    for (const item of mastery.items) {
      if (!fromAnyRelic.has(item.id)) continue;
      const parts = item.components.filter((c) => c.kind === 'part');
      if (!parts.length) continue;
      const rows = [];
      let ok = true;
      for (const part of parts) {
        const have = builtCount(inv, part.id) + blueprintOnlyCount(inv, part.id);
        const list = (drops.get(`${item.id}|${part.id}`) ?? []).sort((a, b) => b.chance - a.chance);
        // Teile, die selbst eine Waffe sind, droppen nicht aus Relikten – zählen nur, wenn du sie schon hast
        if (!list.length && have < part.count) {
          ok = false;
          break;
        }
        rows.push({ part, have, list });
      }
      if (!ok) continue;
      out.push({ item, rows, status: evaluate(item, inv).status, price: p[`${item.name} set`.toLowerCase()] ?? 0 });
    }
    return out;
  });
  const shown = createMemo(() => {
    const keep = { all: () => true, unmastered: (s) => s.status !== 'mastered', notowned: (s) => s.status !== 'mastered' && s.status !== 'leveling' }[view().filter] ?? (() => true);
    const sorter = view().sort === 'name' ? (a, b) => a.item.name.localeCompare(b.item.name) : (a, b) => b.price - a.price || a.item.name.localeCompare(b.item.name);
    return sets().filter(keep).sort(sorter);
  });
  return (
    <>
      <div class="todo-relics-bar">
        <div class="fs-filters">
          <For each={[['all', 'Alle'], ['unmastered', 'Nicht gemeistert'], ['notowned', 'Nicht im Besitz']]}>
            {([id, label]) => (
              <button class="gb-tab" classList={{ active: view().filter === id }} onClick={() => setV({ filter: id })}>
                <span>{t(label)}</span>
              </button>
            )}
          </For>
        </div>
        <select value={view().sort} onChange={(e) => setV({ sort: e.currentTarget.value })} title={t('Sortieren')}>
          <option value="price">{t('Set-Preis')}</option>
          <option value="name">{t('Name')}</option>
        </select>
        <span class="muted small">{t('{n} Sets komplett aus deinen Relikten', { n: shown().length })}</span>
      </div>
      <Show when={shown().length > 0} fallback={<p class="notice">{t('Mit deinen Relikten lässt sich gerade kein Set mit diesem Filter komplett farmen.')}</p>}>
        <div class="tr-grid">
          <For each={shown()}>
            {(s) => (
              <div class={`tr-card fs-card st-${s.status}`}>
                <div class="tr-head fs-head" onClick={() => props.onOpen(s.item)}>
                  <Show when={s.item.image}>
                    <img src={s.item.image} alt="" loading="lazy" />
                  </Show>
                  <b>{s.item.name}</b>
                  <Show when={s.item.vaulted}>
                    <span class="tr-vault" title="Vaulted">
                      <Archive size={13} />
                    </span>
                  </Show>
                  <Show when={s.status === 'mastered'}>
                    <BadgeCheck size={16} class="gb-mastered" />
                  </Show>
                  <span class="fs-price" title={t('Set-Preis (Durchschnitt)')}>
                    <Show when={s.price}>
                      <Plat size={13} /> {Math.round(s.price)}
                    </Show>
                  </span>
                  <TodoStar id={s.item.id} size={16} />
                </div>
                <ul>
                  <For each={s.rows}>
                    {({ part, have, list }) => (
                      <li onClick={() => props.onOpen(s.item, part.id)}>
                        <span class={`tr-dot ${list[0] ? `rar-${rarityOf(list[0].chance)}` : ''}`} />
                        <span class="tr-name">
                          {part.name.replace(`${s.item.name} `, '')}
                          <Show when={part.count > 1}>
                            <small> ×{part.count}</small>
                          </Show>
                          <Show when={have > 0}>
                            <small class="fs-have"> · {t('{n} da', { n: have })}</small>
                          </Show>
                        </span>
                        <span class="fs-relics">
                          <For each={list.slice(0, 2)}>
                            {(d) => (
                              <span class="fs-relic" title={`${d.relic.name}: ${d.total}× · ${d.chance}% (${REF_SHORT[d.best]})`}>
                                <RelicIcon tier={d.relic.tier} size={14} />
                                {d.relic.name}
                                <small>{d.chance}%</small>
                              </span>
                            )}
                          </For>
                          <Show when={list.length > 2}>
                            <small class="muted">+{list.length - 2}</small>
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

export default function TodoRelics(props) {
  const [data] = createResource(() => Promise.all([loadRelicDb(), loadMasteryDb()]).then(([relicDb, mastery]) => ({ relicDb, mastery })));
  const [only, setOnly] = createSignal('all');
  const [mode, setModeState] = createSignal(load('cm.todoRelics.mode', 'todo'));
  const setMode = (m) => {
    setModeState(m);
    save('cm.todoRelics.mode', m);
  };
  const open = () => props.rows.filter((r) => r.status !== 'mastered' && r.status !== 'leveling');
  const needed = createMemo(() => {
    const m = new Map();
    for (const r of open()) {
      if (only() !== 'all' && r.item.id !== only()) continue;
      for (const p of r.parts) {
        const have = p.built + p.bp;
        if (have < p.count) m.set(`${r.item.id}|${p.id}`, { item: r.item, part: p, have, need: p.count });
      }
    }
    return m;
  });
  const result = createMemo(() => {
    const d = data();
    if (!d) return null;
    const { relicDb, mastery } = d;
    const need = needed();
    const matchesOf = (relic, refinement) =>
      (relic.rewards[refinement] ?? relic.rewards.intact ?? [])
        .map((w) => {
          const entry = w.id ? mastery.index.get(w.id) : null;
          const hit = entry?.part ? need.get(`${entry.item.id}|${entry.part.id}`) : null;
          return hit ? { ...hit, chance: w.chance } : null;
        })
        .filter(Boolean);
    const owned = [];
    const covered = new Set();
    const elsewhere = new Map();
    for (const relic of relicDb.relics) {
      const counts = props.inv?.relics?.[relic.id] ?? {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const best = REFINEMENTS.find((r) => counts[r] > 0) ?? 'intact';
      const matches = matchesOf(relic, best);
      if (!matches.length) continue;
      if (total > 0) {
        owned.push({ relic, counts, total, best, matches });
        for (const m of matches) covered.add(`${m.item.id}|${m.part.id}`);
      } else {
        for (const m of matches) {
          const k = `${m.item.id}|${m.part.id}`;
          const e = elsewhere.get(k) ?? { relics: 0, unvaulted: 0 };
          e.relics++;
          if (!relic.vaulted) e.unvaulted++;
          elsewhere.set(k, e);
        }
      }
    }
    owned.sort((a, b) => b.matches.length - a.matches.length || b.total - a.total || a.relic.name.localeCompare(b.relic.name));
    const uncovered = [...need.entries()].filter(([k]) => !covered.has(k)).map(([k, v]) => ({ ...v, key: k, elsewhere: elsewhere.get(k) ?? null }));
    return { owned, uncovered };
  });

  return (
    <section class="todo-relics">
      <div class="fs-mode">
        <button classList={{ active: mode() === 'todo' }} onClick={() => setMode('todo')}>
          <Star size={14} /> {t('Für To-Do-Items')}
        </button>
        <button classList={{ active: mode() === 'sets' }} onClick={() => setMode('sets')}>
          <Layers size={14} /> {t('Volle Sets aus deinen Relikten')}
        </button>
      </div>
      <Switch>
        <Match when={data.error}>
          <p class="err">{data.error.message}</p>
        </Match>
        <Match when={!data()}>
          <div class="empty">{t('Lade Relikte …')}</div>
        </Match>
        <Match when={mode() === 'sets'}>
          <FullSets relicDb={data().relicDb} mastery={data().mastery} inv={props.inv} onOpen={props.onOpen} />
        </Match>
        <Match when={!open().length}>
          <p class="notice ok-notice">{t(props.rows.length ? 'Alle To-Do-Items sind schon im Besitz oder gemeistert.' : 'Deine To-Do-Liste ist leer.')}</p>
        </Match>
        <Match when={result()}>
          <div class="todo-relics-bar">
            <span class="muted">{t('Teile für')}</span>
            <select value={only()} onChange={(e) => setOnly(e.currentTarget.value)}>
              <option value="all">{t('Alle To-Do-Items')}</option>
              <For each={open()}>{(r) => <option value={r.item.id}>{r.item.name}</option>}</For>
            </select>
            <span class="muted small">{t('{n} eigene Relikte mit gesuchten Teilen', { n: result().owned.length })}</span>
          </div>
          <Show when={result().owned.length === 0}>
            <p class="notice">{t('Keines deiner Relikte enthält ein gesuchtes Teil.')}</p>
          </Show>
          <div class="tr-grid">
            <For each={result().owned}>
              {(o) => (
                <div class="tr-card">
                  <div class="tr-head">
                    <RelicIcon tier={o.relic.tier} size={30} />
                    <b>{o.relic.name}</b>
                    <Show when={o.relic.vaulted}>
                      <span class="tr-vault" title="Vaulted">
                        <Archive size={13} />
                      </span>
                    </Show>
                    <span class="tr-counts">
                      <For each={REFINEMENTS.filter((r) => o.counts[r] > 0).reverse()}>
                        {(r) => (
                          <span class={`tr-ref ref-${r}`} title={t(REF_DE[r])}>
                            {o.counts[r]}× {REF_SHORT[r]}
                          </span>
                        )}
                      </For>
                    </span>
                  </div>
                  <ul>
                    <For each={o.matches}>
                      {(m) => (
                        <li onClick={() => props.onOpen(m.item, m.part.id)}>
                          <span class={`tr-dot rar-${rarityOf(m.chance)}`} />
                          <span class="tr-name">
                            <b>{m.item.name}</b> {m.part.name}
                            <Show when={m.need > 1}>
                              <small>
                                {' '}
                                ({m.have}/{m.need})
                              </small>
                            </Show>
                          </span>
                          <span class="tr-chance" title={t('Chance mit {r}', { r: t(REF_DE[o.best]) })}>
                            {m.chance}%
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </div>
          <Show when={result().uncovered.length > 0}>
            <h4 class="tr-sub">
              <PackageX size={15} /> {t('Dafür hast du kein Relikt ({n})', { n: result().uncovered.length })}
            </h4>
            <ul class="tr-missing">
              <For each={result().uncovered}>
                {(u) => (
                  <li onClick={() => props.onOpen(u.item, u.part.id)}>
                    <span class="tr-name">
                      <b>{u.item.name}</b> {u.part.name}
                    </span>
                    <span class="muted small">
                      {u.elsewhere
                        ? u.elsewhere.unvaulted
                          ? t('in {n} Relikten, davon {u} nicht vaulted', { n: u.elsewhere.relics, u: u.elsewhere.unvaulted })
                          : t('nur in {n} vaulted Relikten – Markt oder Prime Resurgence', { n: u.elsewhere.relics })
                        : u.part.drops[0]?.location ?? t('Markt / Dojo / Händler')}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Match>
      </Switch>
    </section>
  );
}

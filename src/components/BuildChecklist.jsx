// Checkliste für einen verfolgten Build: Item, Forma und jeder Mod-Platz – automatisch aus dem
// Inventar abgehakt, sonst von Hand.
import { createResource, For, Show } from 'solid-js';
import { Check, CircleDashed, Store, PartyPopper, RotateCcw, ArrowUpCircle } from 'lucide-solid';
import { cachedPrice, loadPrice } from '../lib/market.js';
import { openMarket } from '../pages/Market.jsx';
import { saved, toggleCheck, markDone, toggleActive } from '../lib/savedBuilds.js';
import { game } from '../lib/game.js';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';
import { loadData, fullCard, WFCD_IMG } from './BuildMods.jsx';

const FORMA = '/Lotus/Types/Items/MiscItems/Forma';
const FORMA_BP = '/Lotus/Types/Recipes/Components/FormaBlueprint';

/** Eine Zeile pro Item, Forma und Mod-Platz. status: 'ok' | 'low' (Rang zu niedrig) | 'missing'. */
export function buildRows(snap, { mods, market }, inv, checks, item) {
  const rows = [];
  if (item) {
    const owned = (inv?.owned?.[item.id] ?? 0) > 0;
    rows.push({ key: 'item', kind: 'item', name: item.name, image: item.image, status: owned ? 'ok' : 'missing' });
  }
  if (snap.formas > 0) {
    const have = inv?.counts?.[FORMA] ?? 0;
    const bp = inv?.counts?.[FORMA_BP] ?? 0;
    rows.push({ key: 'forma', kind: 'forma', need: snap.formas, have, bp, status: have >= snap.formas ? 'ok' : 'missing' });
  }
  for (const s of snap.slots ?? []) {
    if (!s.mod) continue;
    const m = mods[s.mod];
    const mk = m ? market.get(m.p) : null;
    const count = m ? inv?.counts?.[m.p] ?? 0 : 0;
    const rank = m ? inv?.modRanks?.[m.p] ?? (count > 0 ? 0 : null) : null;
    const status = count > 0 ? (rank != null && rank < s.rank ? 'low' : 'ok') : 'missing';
    rows.push({ key: `s${s.slot_id}`, slot: s.slot_id, kind: 'mod', mod: m, market: mk, need: s.rank, have: rank, status });
  }
  return rows.map((r) => ({ ...r, checked: (checks ?? []).includes(r.slot ?? r.key) }));
}

export const isDone = (r) => r.status === 'ok' || r.checked;

export function buildProgress(snap, data, inv, checks, item) {
  const rows = buildRows(snap, data, inv, checks, item);
  return { done: rows.filter(isDone).length, total: rows.length };
}

function BuyButton(props) {
  const r = props.market.maxRank ? (props.rank >= props.market.maxRank ? props.market.maxRank : 0) : 0;
  loadPrice(props.market.slug, { rank: r }).catch(() => {});
  const price = () => cachedPrice(props.market.slug, r);
  return (
    <button class="btn bc-buy" onClick={() => openMarket(props.market.slug)} title={t('Im Markt ansehen')}>
      <Store size={13} />
      {price()?.wts != null ? (
        <>
          {price().wts} <Plat size={12} />
        </>
      ) : (
        t('Markt')
      )}
      <Show when={props.market.maxRank > 0}>
        <small class="muted">{r ? 'Max' : 'R0'}</small>
      </Show>
    </button>
  );
}

export default function BuildChecklist(props) {
  const [data] = createResource(() => loadData().catch(() => ({ mods: {}, market: new Map() })));
  const rows = () => (data() ? buildRows(props.snap, data(), game.inventory, saved.checks[props.snap.id] ?? [], props.item) : []);
  const done = () => rows().filter(isDone).length;
  const pct = () => (rows().length ? Math.round((done() / rows().length) * 100) : 0);
  return (
    <Show when={data()}>
      <section class="bc">
        <div class="bc-head">
          <h3>{t('Fortschritt')}</h3>
          <span class="bc-count">
            {done()}/{rows().length}
          </span>
          <div class="bc-bar">
            <i style={{ width: `${pct()}%` }} />
          </div>
          <Show
            when={done() === rows().length}
            fallback={
              <button class="btn" onClick={() => markDone(props.snap.id)} title={t('Auch wenn noch nicht alles abgehakt ist')}>
                <Check size={15} /> {t('Fertig')}
              </button>
            }
          >
            <button class="btn btn-primary" onClick={() => markDone(props.snap.id)}>
              <PartyPopper size={15} /> {t('Als fertig markieren')}
            </button>
          </Show>
        </div>
        <Show when={!game.inventory}>
          <p class="muted small">{t('Ohne Sync mit dem Spiel kann nichts automatisch abgehakt werden.')}</p>
        </Show>
        <ul class="bc-list">
          <For each={rows()}>
            {(r) => {
              const ok = isDone(r);
              const name =
                r.kind === 'forma'
                  ? t('{n}× Forma', { n: r.need })
                  : r.kind === 'item'
                    ? r.name
                    : r.mod
                      ? (settings.language === 'de' && r.mod.d) || r.mod.n
                      : t('Unbekannte Mod #{id}', { id: r.slot });
              const img = r.kind === 'mod' ? (r.market?.thumb ? fullCard(r.market.thumb) : r.mod?.i ? WFCD_IMG + r.mod.i : null) : r.image;
              let note;
              if (r.kind === 'forma') note = t('Du hast {n} gebaut, {b} als Blaupause', { n: r.have, b: r.bp });
              else if (r.kind === 'item') note = r.status === 'ok' ? t('Im Besitz') : t('Fehlt noch');
              else if (r.status === 'ok') note = t('Im Inventar (Rang {r})', { r: r.have });
              else if (r.status === 'low') note = t('Erst Rang {a} – braucht Rang {b}', { a: r.have, b: r.need });
              else note = t('Fehlt – Rang {b} gebraucht', { b: r.need });
              return (
                <li class={`bc-row ${ok ? 'ok' : r.status}`}>
                  <button
                    class="bc-check"
                    onClick={() => toggleCheck(props.snap.id, r.slot ?? r.key)}
                    title={r.status === 'ok' ? t('Automatisch erkannt') : t('Von Hand abhaken')}
                    disabled={r.status === 'ok'}
                  >
                    {ok ? <Check size={15} /> : r.status === 'low' ? <ArrowUpCircle size={15} /> : <CircleDashed size={15} />}
                  </button>
                  <span class={`bc-img ${r.kind}`}>{img ? <img src={img} alt="" loading="lazy" /> : r.kind === 'forma' ? <span class="bld-forma" /> : null}</span>
                  <span class="bc-main">
                    <b>{name}</b>
                    <small>{r.checked && r.status !== 'ok' ? t('Von Hand abgehakt') : note}</small>
                  </span>
                  <Show when={r.kind === 'mod' && !ok && r.market}>
                    <BuyButton market={r.market} rank={r.need} />
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        <button class="btn bc-stop" onClick={() => toggleActive(props.snap)}>
          <RotateCcw size={14} /> {t('Nicht mehr verfolgen')}
        </button>
      </section>
    </Show>
  );
}

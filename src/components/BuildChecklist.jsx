import { useEffect, useState } from 'react';
import { Check, CircleDashed, Store, PartyPopper, RotateCcw, ArrowUpCircle } from 'lucide-react';
import { getPrice } from '../lib/api.js';
import { openMarket } from '../lib/builds.js';
import { toggleCheck, markDone, toggleActive, useSavedBuilds } from '../lib/savedBuilds.js';
import { useGameData } from '../lib/GameData.jsx';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';
import { loadData, fullCard, WFCD_IMG } from './BuildMods.jsx';

const FORMA = '/Lotus/Types/Items/MiscItems/Forma';
const FORMA_BP = '/Lotus/Types/Recipes/Components/FormaBlueprint';

/**
 * Was zu einem verfolgten Build fehlt. Eine Zeile pro Item, Forma und Mod-Platz.
 * status: 'ok' (vorhanden), 'low' (vorhanden, aber Rang zu niedrig), 'missing'; manuell abgehakt zählt als erledigt.
 */
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
    // Gerankte Exemplare kennt das Inventar mit Rang; unverbesserte zählen als Rang 0
    const rank = m ? inv?.modRanks?.[m.p] ?? (count > 0 ? 0 : null) : null;
    const status = count > 0 ? (rank != null && rank < s.rank ? 'low' : 'ok') : 'missing';
    rows.push({ key: `s${s.slot_id}`, slot: s.slot_id, kind: 'mod', mod: m, market: mk, need: s.rank, have: rank, status });
  }
  return rows.map((r) => ({ ...r, checked: (checks ?? []).includes(r.slot ?? r.key) }));
}

export const isDone = (r) => r.status === 'ok' || r.checked;

/** Fortschritt { done, total } für die Liste „In Arbeit“. */
export function buildProgress(snap, data, inv, checks, item) {
  const rows = buildRows(snap, data, inv, checks, item);
  return { done: rows.filter(isDone).length, total: rows.length };
}

function BuyButton({ market, rank }) {
  const t = useT();
  const [price, setPrice] = useState(null);
  const r = market.maxRank ? (rank >= market.maxRank ? market.maxRank : 0) : 0;
  useEffect(() => {
    let alive = true;
    getPrice(market.slug, { rank: r })
      .then((p) => alive && setPrice(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [market.slug, r]);
  return (
    <button className="btn bc-buy" onClick={() => openMarket(market.slug)} title={t('Im Markt ansehen')}>
      <Store size={13} />
      {price?.wts != null ? (
        <>
          {price.wts} <Plat size={12} />
        </>
      ) : (
        t('Markt')
      )}
      {market.maxRank > 0 && <small className="muted">{r ? 'Max' : 'R0'}</small>}
    </button>
  );
}

export default function BuildChecklist({ snap, item }) {
  const t = useT();
  const { language } = useSettings();
  const { inventory } = useGameData();
  const [data, setData] = useState(null);
  const checks = useChecks(snap.id);
  useEffect(() => {
    loadData()
      .then(setData)
      .catch(() => setData({ mods: {}, market: new Map() }));
  }, []);
  if (!data) return null;

  const rows = buildRows(snap, data, inventory, checks, item);
  const done = rows.filter(isDone).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;

  return (
    <section className="bc">
      <div className="bc-head">
        <h3>{t('Fortschritt')}</h3>
        <span className="bc-count">
          {done}/{rows.length}
        </span>
        <div className="bc-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        {done === rows.length ? (
          <button className="btn btn-primary" onClick={() => markDone(snap.id)}>
            <PartyPopper size={15} /> {t('Als fertig markieren')}
          </button>
        ) : (
          <button className="btn" onClick={() => markDone(snap.id)} title={t('Auch wenn noch nicht alles abgehakt ist')}>
            <Check size={15} /> {t('Fertig')}
          </button>
        )}
      </div>
      {!inventory && <p className="muted small">{t('Ohne Sync mit dem Spiel kann nichts automatisch abgehakt werden.')}</p>}
      <ul className="bc-list">
        {rows.map((r) => {
          const ok = isDone(r);
          const name =
            r.kind === 'forma'
              ? t('{n}× Forma', { n: r.need })
              : r.kind === 'item'
                ? r.name
                : r.mod
                  ? (language === 'de' && r.mod.d) || r.mod.n
                  : t('Unbekannte Mod #{id}', { id: r.slot });
          const img = r.kind === 'mod' ? (r.market?.thumb ? fullCard(r.market.thumb) : r.mod?.i ? WFCD_IMG + r.mod.i : null) : r.image;
          let note;
          if (r.kind === 'forma') note = t('Du hast {n} gebaut, {b} als Blaupause', { n: r.have, b: r.bp });
          else if (r.kind === 'item') note = r.status === 'ok' ? t('Im Besitz') : t('Fehlt noch');
          else if (r.status === 'ok') note = t('Im Inventar (Rang {r})', { r: r.have });
          else if (r.status === 'low') note = t('Erst Rang {a} – braucht Rang {b}', { a: r.have, b: r.need });
          else note = t('Fehlt – Rang {b} gebraucht', { b: r.need });
          return (
            <li key={r.key} className={`bc-row ${ok ? 'ok' : r.status}`}>
              <button
                className="bc-check"
                onClick={() => toggleCheck(snap.id, r.slot ?? r.key)}
                title={r.status === 'ok' ? t('Automatisch erkannt') : t('Von Hand abhaken')}
                disabled={r.status === 'ok'}
              >
                {ok ? <Check size={15} /> : r.status === 'low' ? <ArrowUpCircle size={15} /> : <CircleDashed size={15} />}
              </button>
              <span className={`bc-img ${r.kind}`}>{img ? <img src={img} alt="" loading="lazy" /> : r.kind === 'forma' && <span className="bld-forma" />}</span>
              <span className="bc-main">
                <b>{name}</b>
                <small>{r.checked && r.status !== 'ok' ? t('Von Hand abgehakt') : note}</small>
              </span>
              {r.kind === 'mod' && !ok && r.market && <BuyButton market={r.market} rank={r.need} />}
            </li>
          );
        })}
      </ul>
      <button className="btn bc-stop" onClick={() => toggleActive(snap)}>
        <RotateCcw size={14} /> {t('Nicht mehr verfolgen')}
      </button>
    </section>
  );
}

// Abgehakte Plätze dieses Builds (reagiert auf Änderungen)
function useChecks(id) {
  return useSavedBuilds().checks[id] ?? [];
}

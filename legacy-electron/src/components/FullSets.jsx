import { useEffect, useMemo, useState } from 'react';
import { Archive, BadgeCheck } from 'lucide-react';
import { getBulkPrices, load, save } from '../lib/api.js';
import { evaluate } from '../lib/evaluate.js';
import { builtCount, blueprintOnlyCount } from '../lib/GameData.jsx';
import { rarityOf } from '../lib/relicMath.js';
import { useT } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';
import RelicIcon from './RelicIcon.jsx';
import TodoStar from './TodoStar.jsx';

// To-Do → Relikte → "Volle Sets": Prime-Items, bei denen JEDES Teil aus Relikten kommt, die du gerade besitzt.
// Pro Teil die eigenen Relikte mit der besten Chance (bei der besten vorhandenen Veredelung).

const REFINEMENTS = ['radiant', 'flawless', 'exceptional', 'intact'];
const REF_SHORT = { intact: 'I', exceptional: 'E', flawless: 'F', radiant: 'R' };
const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'unmastered', label: 'Nicht gemeistert' },
  { id: 'notowned', label: 'Nicht im Besitz' },
];
const SORTS = [
  { id: 'price', label: 'Set-Preis' },
  { id: 'name', label: 'Name' },
];
const VIEW_KEY = 'td.fullsets.view.v1';

export default function FullSets({ relicDb, mastery, inv, onOpen }) {
  const t = useT();
  const [prices, setPrices] = useState({});
  const [view, setView] = useState(() => load(VIEW_KEY, { filter: 'all', sort: 'price' }));
  const setV = (patch) => {
    const next = { ...view, ...patch };
    setView(next);
    save(VIEW_KEY, next);
  };

  useEffect(() => {
    getBulkPrices().then(setPrices).catch(() => {});
  }, []);

  const sets = useMemo(() => {
    // Teil-ID -> eigene Relikte, die es droppen
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

    const out = [];
    for (const item of mastery.items) {
      if (!fromAnyRelic.has(item.id)) continue;
      const parts = item.components.filter((c) => c.kind === 'part');
      if (!parts.length) continue;
      const rows = [];
      let ok = true;
      for (const p of parts) {
        const have = builtCount(inv, p.id) + blueprintOnlyCount(inv, p.id);
        const list = (drops.get(`${item.id}|${p.id}`) ?? []).sort((a, b) => b.chance - a.chance);
        // Teile, die selbst eine Waffe sind (Bronco Prime für Akbronco Prime), droppen nicht aus Relikten –
        // die zählen nur, wenn du sie schon hast
        if (!list.length && have < p.count) {
          ok = false;
          break;
        }
        rows.push({ part: p, have, list });
      }
      if (!ok) continue;
      const status = evaluate(item, inv).status;
      out.push({ item, rows, status, price: prices[`${item.name} set`.toLowerCase()] ?? 0 });
    }
    return out;
  }, [relicDb, mastery, inv, prices]);

  const shown = useMemo(() => {
    const keep = {
      all: () => true,
      unmastered: (s) => s.status !== 'mastered',
      notowned: (s) => s.status !== 'mastered' && s.status !== 'leveling',
    }[view.filter] ?? (() => true);
    const sorter = view.sort === 'name' ? (a, b) => a.item.name.localeCompare(b.item.name) : (a, b) => b.price - a.price || a.item.name.localeCompare(b.item.name);
    return sets.filter(keep).sort(sorter);
  }, [sets, view]);

  return (
    <>
      <div className="todo-relics-bar">
        <div className="fs-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`gb-tab ${view.filter === f.id ? 'active' : ''}`} onClick={() => setV({ filter: f.id })}>
              <span>{t(f.label)}</span>
            </button>
          ))}
        </div>
        <select value={view.sort} onChange={(e) => setV({ sort: e.target.value })} title={t('Sortieren')}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.label)}
            </option>
          ))}
        </select>
        <span className="muted small">{t('{n} Sets komplett aus deinen Relikten', { n: shown.length })}</span>
      </div>

      {shown.length === 0 && <p className="notice">{t('Mit deinen Relikten lässt sich gerade kein Set mit diesem Filter komplett farmen.')}</p>}
      <div className="tr-grid">
        {shown.map(({ item, rows, status, price }) => (
          <div key={item.id} className={`tr-card fs-card st-${status}`}>
            <div className="tr-head fs-head" onClick={() => onOpen(item)}>
              {item.image && <img src={item.image} alt="" loading="lazy" />}
              <b>{item.name}</b>
              {item.vaulted && (
                <span className="tr-vault" title="Vaulted">
                  <Archive size={13} />
                </span>
              )}
              {status === 'mastered' && <BadgeCheck size={16} className="gb-mastered" aria-label={t('Gemeistert')} />}
              <span className="fs-price" title={t('Set-Preis (Durchschnitt)')}>
                {price ? (
                  <>
                    <Plat size={13} /> {Math.round(price)}
                  </>
                ) : null}
              </span>
              <TodoStar id={item.id} size={16} />
            </div>
            <ul>
              {rows.map(({ part, have, list }) => (
                <li key={part.id} onClick={() => onOpen(item, part.id)}>
                  <span className={`tr-dot ${list[0] ? `rar-${rarityOf(list[0].chance)}` : ''}`} />
                  <span className="tr-name">
                    {part.name.replace(`${item.name} `, '')}
                    {part.count > 1 && <small> ×{part.count}</small>}
                    {have > 0 && <small className="fs-have"> · {t('{n} da', { n: have })}</small>}
                  </span>
                  <span className="fs-relics">
                    {list.slice(0, 2).map((d) => (
                      <span key={d.relic.id} className="fs-relic" title={`${d.relic.name}: ${d.total}× · ${d.chance}% (${REF_SHORT[d.best]})`}>
                        <RelicIcon tier={d.relic.tier} size={14} />
                        {d.relic.name}
                        <small>{d.chance}%</small>
                      </span>
                    ))}
                    {list.length > 2 && <small className="muted">+{list.length - 2}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

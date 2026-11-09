import { useEffect, useMemo, useState } from 'react';
import { Archive, PackageX, Star, Layers } from 'lucide-react';
import { game, load, save } from '../lib/api.js';
import FullSets from './FullSets.jsx';
import { loadMasteryDb } from '../lib/masteryDb.js';
import { rarityOf } from '../lib/relicMath.js';
import { useT } from '../lib/i18n.js';
import RelicIcon from './RelicIcon.jsx';

// To-Do → Relikte: alle eigenen Relikte, die noch fehlende Teile der To-Do-Items enthalten.
// Darunter die Teile, für die man (noch) kein passendes Relikt besitzt.
// Zweite Ansicht "Volle Sets": Sets, die komplett aus eigenen Relikten farmbar sind (FullSets.jsx).

const REFINEMENTS = ['radiant', 'flawless', 'exceptional', 'intact'];
const REF_SHORT = { intact: 'I', exceptional: 'E', flawless: 'F', radiant: 'R' };
const REF_DE = { intact: 'Intakt', exceptional: 'Außergewöhnlich', flawless: 'Makellos', radiant: 'Strahlend' };

let relicPromise = null;
const loadRelics = () => (relicPromise ??= game.relicDb().catch((e) => ((relicPromise = null), Promise.reject(e))));

/**
 * @param rows  To-Do-Zeilen aus evaluate() (Item + Teile mit built/bp)
 * @param inv   zusammengefasstes Inventar (inv.relics = { relicId: { intact, exceptional, … } })
 */
export default function TodoRelics({ rows, inv, onOpen }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [only, setOnly] = useState('all'); // Item-ID oder 'all'
  const [mode, setModeState] = useState(() => load('td.todoRelics.mode', 'todo')); // 'todo' | 'sets'
  const setMode = (m) => {
    setModeState(m);
    save('td.todoRelics.mode', m);
  };

  useEffect(() => {
    Promise.all([loadRelics(), loadMasteryDb()])
      .then(([relicDb, mastery]) => setData({ relicDb, mastery }))
      .catch((e) => setError(e.message));
  }, []);

  // Fehlende Teile der offenen To-Do-Items: "itemId|partId" -> { item, part, have, need }
  const open = rows.filter((r) => r.status !== 'mastered' && r.status !== 'leveling');
  const needed = useMemo(() => {
    const m = new Map();
    for (const r of open) {
      if (only !== 'all' && r.item.id !== only) continue;
      for (const p of r.parts) {
        const have = p.built + p.bp;
        if (have < p.count) m.set(`${r.item.id}|${p.id}`, { item: r.item, part: p, have, need: p.count });
      }
    }
    return m;
  }, [open, only]);

  const result = useMemo(() => {
    if (!data) return null;
    const { relicDb, mastery } = data;
    const matchesOf = (relic, refinement) =>
      (relic.rewards[refinement] ?? relic.rewards.intact ?? [])
        .map((w) => {
          const entry = w.id ? mastery.index.get(w.id) : null;
          const hit = entry?.part ? needed.get(`${entry.item.id}|${entry.part.id}`) : null;
          return hit ? { ...hit, chance: w.chance } : null;
        })
        .filter(Boolean);

    const owned = [];
    const covered = new Set();
    const elsewhere = new Map(); // Teil -> Anzahl nicht eigener Relikte, die es droppen (davon unvaulted)
    for (const relic of relicDb.relics) {
      const counts = inv?.relics?.[relic.id] ?? {};
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
    // Erst die Relikte mit den meisten gesuchten Teilen, dann die mit den meisten Exemplaren
    owned.sort((a, b) => b.matches.length - a.matches.length || b.total - a.total || a.relic.name.localeCompare(b.relic.name));
    const uncovered = [...needed.entries()]
      .filter(([k]) => !covered.has(k))
      .map(([k, v]) => ({ ...v, key: k, elsewhere: elsewhere.get(k) ?? null }));
    return { owned, uncovered };
  }, [data, needed, inv]);

  if (error) return <p className="err">{error}</p>;
  if (!result) return <div className="empty">{t('Lade Relikte …')}</div>;

  const modeBar = (
    <div className="fs-mode">
      <button className={mode === 'todo' ? 'active' : ''} onClick={() => setMode('todo')}>
        <Star size={14} /> {t('Für To-Do-Items')}
      </button>
      <button className={mode === 'sets' ? 'active' : ''} onClick={() => setMode('sets')}>
        <Layers size={14} /> {t('Volle Sets aus deinen Relikten')}
      </button>
    </div>
  );
  if (mode === 'sets') {
    return (
      <section className="todo-relics">
        {modeBar}
        <FullSets relicDb={data.relicDb} mastery={data.mastery} inv={inv} onOpen={onOpen} />
      </section>
    );
  }
  if (!open.length) {
    return (
      <section className="todo-relics">
        {modeBar}
        <p className="notice ok-notice">{t(rows.length ? 'Alle To-Do-Items sind schon im Besitz oder gemeistert.' : 'Deine To-Do-Liste ist leer.')}</p>
      </section>
    );
  }

  return (
    <section className="todo-relics">
      {modeBar}
      <div className="todo-relics-bar">
        <span className="muted">{t('Teile für')}</span>
        <select value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="all">{t('Alle To-Do-Items')}</option>
          {open.map((r) => (
            <option key={r.item.id} value={r.item.id}>
              {r.item.name}
            </option>
          ))}
        </select>
        <span className="muted small">
          {t('{n} eigene Relikte mit gesuchten Teilen', { n: result.owned.length })}
        </span>
      </div>

      {result.owned.length === 0 && <p className="notice">{t('Keines deiner Relikte enthält ein gesuchtes Teil.')}</p>}
      <div className="tr-grid">
        {result.owned.map(({ relic, counts, best, matches }) => (
          <div key={relic.id} className="tr-card">
            <div className="tr-head">
              <RelicIcon tier={relic.tier} size={30} />
              <b>{relic.name}</b>
              {relic.vaulted && (
                <span className="tr-vault" title="Vaulted">
                  <Archive size={13} />
                </span>
              )}
              <span className="tr-counts">
                {REFINEMENTS.filter((r) => counts[r] > 0)
                  .reverse()
                  .map((r) => (
                    <span key={r} className={`tr-ref ref-${r}`} title={t(REF_DE[r])}>
                      {counts[r]}× {REF_SHORT[r]}
                    </span>
                  ))}
              </span>
            </div>
            <ul>
              {matches.map((m) => (
                <li key={`${m.item.id}|${m.part.id}`} onClick={() => onOpen(m.item, m.part.id)}>
                  <span className={`tr-dot rar-${rarityOf(m.chance)}`} />
                  <span className="tr-name">
                    <b>{m.item.name}</b> {m.part.name}
                    {m.need > 1 && <small> ({m.have}/{m.need})</small>}
                  </span>
                  <span className="tr-chance" title={t('Chance mit {r}', { r: t(REF_DE[best]) })}>
                    {m.chance}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {result.uncovered.length > 0 && (
        <>
          <h4 className="tr-sub">
            <PackageX size={15} /> {t('Dafür hast du kein Relikt ({n})', { n: result.uncovered.length })}
          </h4>
          <ul className="tr-missing">
            {result.uncovered.map((u) => (
              <li key={u.key} onClick={() => onOpen(u.item, u.part.id)}>
                <span className="tr-name">
                  <b>{u.item.name}</b> {u.part.name}
                </span>
                <span className="muted small">
                  {u.elsewhere
                    ? u.elsewhere.unvaulted
                      ? t('in {n} Relikten, davon {u} nicht vaulted', { n: u.elsewhere.relics, u: u.elsewhere.unvaulted })
                      : t('nur in {n} vaulted Relikten – Markt oder Prime Resurgence', { n: u.elsewhere.relics })
                    : u.part.drops[0]?.location ?? t('Markt / Dojo / Händler')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

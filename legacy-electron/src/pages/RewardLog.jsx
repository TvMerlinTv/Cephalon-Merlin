import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { game, getBulkPrices, getItems, isElectron } from '../lib/api.js';
import { loadMasteryDb } from '../lib/masteryDb.js';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { Plat, Ducat } from '../components/Icons.jsx';
import './rewardLog.css';

// Belohnungs-Log der Spalten-Missionen (electron/rewardLog.cjs): letzte Runs + Summen pro Tag/Woche.
// Gespeichert sind nur die Namen; Platin (Sammelpreise) und Ducats kommen hier dazu.
// Ohne bekannte Wahl zählt die wertvollste Belohnung (nach Platin) als angenommene Wahl.

const REFINEMENT = { intact: 'Intakt', exceptional: 'Außergewöhnlich', flawless: 'Makellos', radiant: 'Strahlend' };
const PAGE = 30;
const ONE = { maximumFractionDigits: 1 };

/** Montag der Woche bzw. Tagesbeginn (lokale Zeit) als Schlüssel. */
function weekStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function dayStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Name -> { plat, ducats } aus Sammelpreisen, Relikt-DB (Item-ID/Slug), Mastery-DB und warframe.market. */
function useValueOf() {
  const [valueOf, setValueOf] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      getBulkPrices().catch(() => ({})),
      game.relicDb().catch(() => ({ relics: [] })),
      loadMasteryDb().catch(() => null),
      getItems().catch(() => []),
    ]).then(([prices, relicDb, mastery, items]) => {
      const rewards = new Map();
      for (const r of relicDb.relics ?? []) for (const w of r.rewards?.intact ?? []) rewards.set(w.name, w);
      const marketDucats = new Map(items.map((i) => [i.slug, i.ducats]));
      const cache = new Map();
      const fn = (name) => {
        if (!cache.has(name)) {
          const w = rewards.get(name);
          const ducats = (w?.id && mastery?.index.get(w.id)?.part?.ducats) || (w?.slug && marketDucats.get(w.slug)) || 0;
          cache.set(name, { plat: prices[name.toLowerCase()] ?? null, ducats });
        }
        return cache.get(name);
      };
      if (alive) setValueOf(() => fn);
    });
    return () => {
      alive = false;
    };
  }, []);
  return valueOf;
}

/** Wert eines Runs: gewählte Belohnung – oder (unbekannt) die mit dem höchsten Platin-Wert. */
function runValue(run, valueOf) {
  const items = run.items.map((name) => ({ name, ...valueOf(name) }));
  const best = items.reduce((a, b) => ((b.plat ?? 0) > (a.plat ?? 0) || ((b.plat ?? 0) === (a.plat ?? 0) && b.ducats > a.ducats) ? b : a));
  const pick = (run.chosen && items.find((i) => i.name === run.chosen)) || best;
  return { items, pick: pick.name, assumed: !run.chosen, plat: pick.plat ?? 0, ducats: pick.ducats };
}

function Sums({ runs, by }) {
  const t = useT();
  const locale = useSettings().language === 'en' ? 'en-GB' : 'de-DE';
  const rows = useMemo(() => {
    const groups = new Map();
    for (const r of runs) {
      const k = by === 'week' ? weekStart(r.t) : dayStart(r.t);
      const g = groups.get(k) ?? { k, runs: 0, plat: 0, ducats: 0 };
      g.runs++;
      g.plat += r.value.plat;
      g.ducats += r.value.ducats;
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => b.k - a.k).slice(0, by === 'week' ? 12 : 14);
  }, [runs, by]);
  const label = (k) =>
    by === 'week'
      ? t('Woche ab {d}', { d: new Date(k).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) })
      : new Date(k).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <div className="st-table-wrap">
      <table className="st-table rl-sums">
        <thead>
          <tr>
            <th>{t(by === 'week' ? 'Woche' : 'Tag')}</th>
            <th>{t('Runs')}</th>
            <th>{t('Platin')}</th>
            <th>{t('Ducats')}</th>
            <th>{t('Ø Platin pro Run')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.k}>
              <td>{label(g.k)}</td>
              <td>{g.runs}</td>
              <td>
                <span className="rl-val">
                  <Plat size={13} /> {g.plat.toLocaleString(locale, ONE)}
                </span>
              </td>
              <td>
                <span className="rl-val">
                  <Ducat size={13} /> {g.ducats.toLocaleString(locale)}
                </span>
              </td>
              <td>{(g.plat / g.runs).toLocaleString(locale, { maximumFractionDigits: 1 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Run({ run, onChoose, onRemove }) {
  const t = useT();
  const locale = useSettings().language === 'en' ? 'en-GB' : 'de-DE';
  const { items, pick, assumed } = run.value;
  return (
    <li className="rl-run">
      <div className="rl-head">
        <span className="rl-time">
          {new Date(run.t).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="muted">
          {run.relic?.name ? `${run.relic.name}${run.relic.refinement ? ` · ${t(REFINEMENT[run.relic.refinement] ?? run.relic.refinement)}` : ''}` : t('Relikt unbekannt')}
        </span>
        <div className="gb-spacer" />
        <button className="rl-del" onClick={() => onRemove(run)} title={t('Eintrag löschen')}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="rl-items">
        {items.map((it) => (
          <button
            key={it.name}
            className={`rl-item ${it.name === pick ? (assumed ? 'assumed' : 'chosen') : ''}`}
            onClick={() => onChoose(run, run.chosen === it.name ? null : it.name)}
            title={t(run.chosen === it.name ? 'Wahl zurücksetzen' : 'Als gewählt markieren')}
          >
            <span className="rl-name">{it.name}</span>
            <span className="rl-vals">
              <span className="rl-val">
                <Plat size={12} /> {it.plat == null ? '–' : it.plat.toLocaleString(locale, ONE)}
              </span>
              <span className="rl-val">
                <Ducat size={12} /> {it.ducats || '–'}
              </span>
            </span>
            {it.name === pick && <em>{t(assumed ? 'beste (angenommen)' : 'gewählt')}</em>}
          </button>
        ))}
      </div>
    </li>
  );
}

export default function RewardLog() {
  const t = useT();
  const valueOf = useValueOf();
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [by, setBy] = useState('day');
  const [shown, setShown] = useState(PAGE);

  const reload = () =>
    game
      .rewardLog()
      .then((list) => setRuns(list ?? []))
      .catch((e) => setError(e.message ?? String(e)));

  useEffect(() => {
    reload();
    // Neue Runs vom Overlay sofort zeigen (nur Electron)
    if (isElectron && window.wf.onRewardLog) return window.wf.onRewardLog(reload);
  }, []);

  const valued = useMemo(
    () => (runs && valueOf ? [...runs].sort((a, b) => b.t - a.t).map((r) => ({ ...r, value: runValue(r, valueOf) })) : null),
    [runs, valueOf],
  );

  const onChoose = (run, chosen) => {
    setRuns((list) => list.map((r) => (r.id === run.id ? { ...r, chosen } : r)));
    game.rewardLogChoose(run.id, chosen).catch((e) => setError(e.message ?? String(e)));
  };
  const onRemove = (run) => {
    setRuns((list) => list.filter((r) => r.id !== run.id));
    game.rewardLogRemove(run.id).catch((e) => setError(e.message ?? String(e)));
  };

  if (error) return <p className="err">{error}</p>;
  if (!valued) return <div className="empty">{t('Lade Belohnungs-Log …')}</div>;
  if (!valued.length)
    return (
      <div className="empty">
        {t('Noch keine Spalten-Runs gespeichert. Nach jeder Spalten-Mission merkt sich die App hier die 4 Belohnungen vom Belohnungs-Bildschirm.')}
      </div>
    );

  return (
    <div className="rl">
      <section className="rl-block">
        <div className="gb-bar">
          <h3 className="rl-title">{t('Summen')}</h3>
          <div className="gb-spacer" />
          {[
            ['day', 'Pro Tag'],
            ['week', 'Pro Woche'],
          ].map(([id, label]) => (
            <button key={id} className={`gb-tab ${by === id ? 'active' : ''}`} onClick={() => setBy(id)}>
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
        <Sums runs={valued} by={by} />
        <p className="muted rl-hint">
          {t('Gezählt wird pro Run die gewählte Belohnung. Ist sie unbekannt, zählt die wertvollste – klicke eine Belohnung an, um deine Wahl festzulegen.')}
        </p>
      </section>

      <section className="rl-block">
        <div className="gb-bar">
          <h3 className="rl-title">{t('Letzte Runs')}</h3>
          <div className="gb-spacer" />
          <span className="muted st-count">{t('{n} Runs', { n: valued.length })}</span>
        </div>
        <ul className="rl-runs">
          {valued.slice(0, shown).map((r) => (
            <Run key={r.id} run={r} onChoose={onChoose} onRemove={onRemove} />
          ))}
        </ul>
        {valued.length > shown && (
          <button className="btn rl-more" onClick={() => setShown((n) => n + PAGE)}>
            {t('Mehr anzeigen')}
          </button>
        )}
      </section>
    </div>
  );
}

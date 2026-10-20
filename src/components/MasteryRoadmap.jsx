import { useMemo, useState } from 'react';
import { Lock, Info, Trophy } from 'lucide-react';
import TodoStar from './TodoStar.jsx';
import { useT } from '../lib/i18n.js';

const PAGE = 30;

// Aufwand: zuerst was man schon hat, zuletzt was komplett fehlt
const EFFORT = { leveling: 0, buildable: 1, blueprints: 2, missing: 3 };

/** Gesamt-Mastery-XP, die für MR n nötig ist (ab MR 30: Legendary-Ränge). */
export function mrThreshold(n) {
  if (n <= 30) return 2500 * n * n;
  return 2_250_000 + 147_500 * (n - 30);
}

/** "MR 12" bzw. "L3" für Legendary-Ränge */
export function mrLabel(n) {
  return n > 30 ? `L${n - 30}` : `MR ${n}`;
}

/**
 * Mastery-XP pro Rang: Frames/Begleiter/Archwings 200, Waffen 100.
 * Die DB speichert Affinität (1000·Rang² bzw. 500·Rang²) – Mastery ist ein Fünftel davon pro Rang.
 */
export function masteryPerRank(item) {
  return item.maxXp / (item.maxRank * item.maxRank) / 5;
}

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

export default function MasteryRoadmap({ rows, inv, onOpen }) {
  const t = useT();
  const [limit, setLimit] = useState(PAGE);
  const mr = inv?.player.mr ?? 0;

  const plan = useMemo(() => {
    let itemXp = 0;
    for (const r of rows) itemXp += r.rank * masteryPerRank(r.item);
    // Star Chart, Steel Path, Intrinsics & Co. stehen nicht im Inventar.
    // Der aktuelle MR verrät aber, wie viel XP mindestens vorhanden sein muss.
    const other = Math.max(0, mrThreshold(mr) - itemXp);
    const total = itemXp + other;

    const open = rows.filter((r) => r.status !== 'mastered');
    const locked = open.filter((r) => r.item.masteryReq > mr).length;
    const list = open
      .filter((r) => r.item.masteryReq <= mr)
      .map((r) => ({ ...r, gain: (r.item.maxRank - r.rank) * masteryPerRank(r.item) }))
      .filter((r) => r.gain > 0)
      .sort((a, b) => EFFORT[a.status] - EFFORT[b.status] || b.gain - a.gain || a.item.name.localeCompare(b.item.name));

    // Kumuliert: bei welchem Item wird welcher MR erreicht?
    let sum = total;
    let reach = mr;
    while (mrThreshold(reach + 1) <= sum) reach++; // XP reicht schon, Rang-Test fehlt nur
    for (const r of list) {
      sum += r.gain;
      r.reached = [];
      while (mrThreshold(reach + 1) <= sum) r.reached.push(++reach);
    }
    const firstUp = list.findIndex((r) => r.reached.length > 0);
    const gainAll = list.reduce((s, r) => s + r.gain, 0);
    return { itemXp, other, total, list, locked, firstUp, finalMr: reach, gainAll };
  }, [rows, mr]);

  if (!inv) return <div className="empty">{t('Ohne Sync kennt der Fahrplan deinen MR und deine Item-Ränge nicht.')}</div>;

  const next = mr + 1;
  const prev = mrThreshold(mr);
  const need = mrThreshold(next);
  const toNext = Math.max(0, need - plan.total);
  const testReady = plan.total >= need;
  const progress = Math.min(1, (plan.total - prev) / (need - prev));
  const nextCount = plan.firstUp + 1;

  return (
    <div className="roadmap">
      <div className="mr-head">
        <span className="mr-big">{mrLabel(mr)}</span>
        <div className="mr-bar-wrap">
          <div className="mr-bar-label">
            <span>
              {t('Gesamt-XP')} {plan.other > 0 && '≈ '}
              <b>{fmt(plan.total)}</b>
            </span>
            <span>
              {testReady
                ? t('Genug XP für {mr} – Rang-Test machen!', { mr: mrLabel(next) })
                : t('noch {x} XP bis {mr}', { x: fmt(toNext), mr: mrLabel(next) })}
            </span>
          </div>
          <div className="bar">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="roadmap-stats">
        <div className="cat-card">
          <span className="muted small">{t('Aus Items (Inventar)')}</span>
          <b>{fmt(plan.itemXp)}</b>
        </div>
        <div className="cat-card">
          <span className="muted small">{t('Star Chart, Intrinsics & Co. (geschätzt)')}</span>
          <b>{plan.other > 0 ? `≥ ${fmt(plan.other)}` : '?'}</b>
        </div>
        <div className="cat-card">
          <span className="muted small">{t('Noch offen in erreichbaren Items')}</span>
          <b>{fmt(plan.gainAll)}</b>
        </div>
      </div>
      <p className="muted small roadmap-note">
        <Info size={13} />{' '}
        {t(
          'Item-XP stammt aus deinem Inventar. Star-Chart-, Steel-Path-, Intrinsics- und Railjack-XP liest die App nicht aus – dieser Anteil ist eine Schätzung aus deinem MR (mindestens so viel). Die echte Restmenge bis zum nächsten MR ist daher eher kleiner.',
        )}
      </p>

      {plan.list.length === 0 ? (
        <div className="empty">{t('Alle Items, die dein MR erlaubt, sind gemeistert. 🎉')}</div>
      ) : (
        <>
          <p className="notice roadmap-headline">
            <Trophy size={16} />{' '}
            {testReady
              ? t('Du hast schon genug XP für {mr} – mach den Rang-Test.', { mr: mrLabel(next) })
              : plan.firstUp >= 0
                ? t(nextCount === 1 ? 'Dieses Item bringt dich auf {mr}.' : 'Diese {n} Items bringen dich auf {mr}.', {
                    n: nextCount,
                    mr: mrLabel(next),
                  })
                : t('Alle {n} erreichbaren Items zusammen reichen noch nicht für {mr} – der Rest kommt aus Star Chart, Steel Path und Intrinsics.', {
                    n: plan.list.length,
                    mr: mrLabel(next),
                  })}
            {plan.finalMr > next &&
              ' ' + t('Mit allen {n} Items kämst du bis {mr}.', { n: plan.list.length, mr: mrLabel(plan.finalMr) })}
          </p>
          <ol className="roadmap-list">
            {plan.list.slice(0, limit).map((r, i) => (
              <RoadmapRow key={r.item.id} row={r} index={i} onOpen={() => onOpen(r.item)} />
            ))}
          </ol>
          {plan.list.length > limit && (
            <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('Mehr anzeigen ({n} weitere)', { n: plan.list.length - limit })}
            </button>
          )}
          {plan.locked > 0 && (
            <p className="muted small">
              <Lock size={12} /> {t('{n} weitere Items brauchen einen höheren MR.', { n: plan.locked })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RoadmapRow({ row, index, onOpen }) {
  const t = useT();
  const { item, status, rank, gain, reached } = row;
  return (
    <>
      <li className={`roadmap-row status-${status}`} onClick={onOpen}>
        <span className="roadmap-idx muted">{index + 1}</span>
        <div className="item-img sm">{item.image && <img src={item.image} alt="" loading="lazy" />}</div>
        <div className="mastery-title">
          <span className="item-name">{item.name}</span>
          <div className="mastery-tags">
            <span className="tag">{t(item.category)}</span>
            {item.masteryReq > 0 && <span className="tag">MR {item.masteryReq}</span>}
            {item.vaulted && (
              <span className="tag tag-vault">
                <Lock size={11} /> Vaulted
              </span>
            )}
          </div>
        </div>
        <span className="roadmap-gain">+{fmt(gain)} XP</span>
        <span className={`status-chip ${status}`}>
          {status === 'leveling' && t('Rang {a}/{b}', { a: rank, b: item.maxRank })}
          {status === 'buildable' && t('Baubar')}
          {status === 'blueprints' && t('Blaupausen da')}
          {status === 'missing' && t('Fehlt')}
        </span>
        <TodoStar id={item.id} />
      </li>
      {reached.map((n) => (
        <li key={n} className="roadmap-milestone">
          <Trophy size={14} /> {t('{mr} erreicht', { mr: mrLabel(n) })}
        </li>
      ))}
    </>
  );
}

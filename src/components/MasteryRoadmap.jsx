// Fahrplan: in welcher Reihenfolge welche Items dich am schnellsten zum nächsten MR bringen.
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Lock, Info, Trophy } from 'lucide-solid';
import TodoStar from './TodoStar.jsx';
import BuildNeeds, { blueprintLabel } from './BuildNeeds.jsx';
import { t } from '../lib/i18n.js';

const PAGE = 30;
// Aufwand: zuerst was man schon hat, zuletzt was komplett fehlt
const EFFORT = { leveling: 0, buildable: 1, blueprints: 2, missing: 3 };

/** Gesamt-Mastery-XP, die für MR n nötig ist (ab MR 30: Legendary-Ränge). */
export function mrThreshold(n) {
  if (n <= 30) return 2500 * n * n;
  return 2_250_000 + 147_500 * (n - 30);
}
export const mrLabel = (n) => (n > 30 ? `L${n - 30}` : `MR ${n}`);
/** Mastery-XP pro Rang: Frames/Begleiter/Archwings 200, Waffen 100. */
export const masteryPerRank = (item) => item.maxXp / (item.maxRank * item.maxRank) / 5;
const fmt = (n) => Math.round(n).toLocaleString('de-DE');

function RoadmapRow(props) {
  const r = props.row;
  return (
    <>
      <li class={`roadmap-row status-${r.status}`} onClick={props.onOpen}>
        <span class="roadmap-idx muted">{props.index + 1}</span>
        <div class="item-img sm">
          <Show when={r.item.image}>
            <img src={r.item.image} alt="" loading="lazy" />
          </Show>
        </div>
        <div class="mastery-title">
          <span class="item-name">{r.item.name}</span>
          <div class="mastery-tags">
            <span class="tag">{t(r.item.category)}</span>
            <Show when={r.item.masteryReq > 0}>
              <span class="tag">MR {r.item.masteryReq}</span>
            </Show>
            <Show when={r.item.vaulted}>
              <span class="tag tag-vault">
                <Lock size={11} /> Vaulted
              </span>
            </Show>
          </div>
        </div>
        <BuildNeeds row={r} inv={props.inv} />
        <span class="roadmap-gain">+{fmt(r.gain)} XP</span>
        <span class={`status-chip ${r.status}`}>
          {r.status === 'leveling' && t('Rang {a}/{b}', { a: r.rank, b: r.item.maxRank })}
          {r.status === 'buildable' && t('Baubar')}
          {r.status === 'blueprints' && blueprintLabel(r)}
          {r.status === 'missing' && t('Fehlt')}
        </span>
        <TodoStar id={r.item.id} />
      </li>
      <For each={r.reached}>
        {(n) => (
          <li class="roadmap-milestone">
            <Trophy size={14} /> {t('{mr} erreicht', { mr: mrLabel(n) })}
          </li>
        )}
      </For>
    </>
  );
}

export default function MasteryRoadmap(props) {
  const [limit, setLimit] = createSignal(PAGE);
  const mr = () => props.inv?.player.mr ?? 0;

  const plan = createMemo(() => {
    let itemXp = 0;
    for (const r of props.rows) itemXp += r.rank * masteryPerRank(r.item);
    // Star Chart, Steel Path, Intrinsics & Co. stehen nicht im Inventar – der MR verrät das Minimum
    const other = Math.max(0, mrThreshold(mr()) - itemXp);
    const total = itemXp + other;
    const open = props.rows.filter((r) => r.status !== 'mastered');
    const locked = open.filter((r) => r.item.masteryReq > mr()).length;
    const list = open
      .filter((r) => r.item.masteryReq <= mr())
      .map((r) => ({ ...r, gain: (r.item.maxRank - r.rank) * masteryPerRank(r.item) }))
      .filter((r) => r.gain > 0)
      .sort((a, b) => EFFORT[a.status] - EFFORT[b.status] || b.gain - a.gain || a.item.name.localeCompare(b.item.name));
    let sum = total;
    let reach = mr();
    while (mrThreshold(reach + 1) <= sum) reach++;
    for (const r of list) {
      sum += r.gain;
      r.reached = [];
      while (mrThreshold(reach + 1) <= sum) r.reached.push(++reach);
    }
    const firstUp = list.findIndex((r) => r.reached.length > 0);
    const gainAll = list.reduce((s, r) => s + r.gain, 0);
    return { itemXp, other, total, list, locked, firstUp, finalMr: reach, gainAll };
  });

  const next = () => mr() + 1;
  const need = () => mrThreshold(next());
  const testReady = () => plan().total >= need();
  const progress = () => Math.min(1, (plan().total - mrThreshold(mr())) / (need() - mrThreshold(mr())));

  return (
    <Show when={props.inv} fallback={<div class="empty">{t('Ohne Sync kennt der Fahrplan deinen MR und deine Item-Ränge nicht.')}</div>}>
      <div class="roadmap">
        <div class="mr-head">
          <span class="mr-big">{mrLabel(mr())}</span>
          <div class="mr-bar-wrap">
            <div class="mr-bar-label">
              <span>
                {t('Gesamt-XP')} {plan().other > 0 ? '≈ ' : ''}
                <b>{fmt(plan().total)}</b>
              </span>
              <span>
                {testReady()
                  ? t('Genug XP für {mr} – Rang-Test machen!', { mr: mrLabel(next()) })
                  : t('noch {x} XP bis {mr}', { x: fmt(Math.max(0, need() - plan().total)), mr: mrLabel(next()) })}
              </span>
            </div>
            <div class="bar">
              <i style={{ width: `${progress() * 100}%` }} />
            </div>
          </div>
        </div>
        <div class="roadmap-stats">
          <div class="cat-card">
            <span class="muted small">{t('Aus Items (Inventar)')}</span>
            <b>{fmt(plan().itemXp)}</b>
          </div>
          <div class="cat-card">
            <span class="muted small">{t('Star Chart, Intrinsics & Co. (geschätzt)')}</span>
            <b>{plan().other > 0 ? `≥ ${fmt(plan().other)}` : '?'}</b>
          </div>
          <div class="cat-card">
            <span class="muted small">{t('Noch offen in erreichbaren Items')}</span>
            <b>{fmt(plan().gainAll)}</b>
          </div>
        </div>
        <p class="muted small roadmap-note">
          <Info size={13} />{' '}
          {t(
            'Item-XP stammt aus deinem Inventar. Star-Chart-, Steel-Path-, Intrinsics- und Railjack-XP liest die App nicht aus – dieser Anteil ist eine Schätzung aus deinem MR (mindestens so viel). Die echte Restmenge bis zum nächsten MR ist daher eher kleiner.',
          )}
        </p>
        <Show when={plan().list.length > 0} fallback={<div class="empty">{t('Alle Items, die dein MR erlaubt, sind gemeistert. 🎉')}</div>}>
          <p class="notice roadmap-headline">
            <Trophy size={16} />{' '}
            {testReady()
              ? t('Du hast schon genug XP für {mr} – mach den Rang-Test.', { mr: mrLabel(next()) })
              : plan().firstUp >= 0
                ? t(plan().firstUp === 0 ? 'Dieses Item bringt dich auf {mr}.' : 'Diese {n} Items bringen dich auf {mr}.', { n: plan().firstUp + 1, mr: mrLabel(next()) })
                : t('Alle {n} erreichbaren Items zusammen reichen noch nicht für {mr} – der Rest kommt aus Star Chart, Steel Path und Intrinsics.', {
                    n: plan().list.length,
                    mr: mrLabel(next()),
                  })}
            {plan().finalMr > next() ? ' ' + t('Mit allen {n} Items kämst du bis {mr}.', { n: plan().list.length, mr: mrLabel(plan().finalMr) }) : ''}
          </p>
          <ol class="roadmap-list">
            <For each={plan().list.slice(0, limit())}>{(r, i) => <RoadmapRow row={r} index={i()} inv={props.inv} onOpen={() => props.onOpen(r.item)} />}</For>
          </ol>
          <Show when={plan().list.length > limit()}>
            <button class="btn more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('Mehr anzeigen ({n} weitere)', { n: plan().list.length - limit() })}
            </button>
          </Show>
          <Show when={plan().locked > 0}>
            <p class="muted small">
              <Lock size={12} /> {t('{n} weitere Items brauchen einen höheren MR.', { n: plan().locked })}
            </p>
          </Show>
        </Show>
      </div>
    </Show>
  );
}

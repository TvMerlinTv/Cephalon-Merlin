import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Swords, Skull, Radio, Check, Gem } from 'lucide-react';
import { load, save } from '../lib/api.js';
import { countdown } from '../lib/format.js';
import { useT } from '../lib/i18n.js';
import { useWorldChecks, toggleRound, toggleChallenge, pruneChallenges } from '../lib/worldChecks.js';

// Reiter „Aufgaben“ im Timer-Panel: Sortie, Archon-Jagd und Nightwave (Daten aus electron/world.cjs).

const OPEN_KEY = 'td.worldtasks.open';
const SHARD = { crimson: 'Karmesin-Scherbe', amber: 'Bernstein-Scherbe', azure: 'Azur-Scherbe' };
const KINDS = [
  ['daily', 'Täglich'],
  ['weekly', 'Wöchentlich'],
  ['elite', 'Elite wöchentlich'],
];

function DoneBox({ done, onClick, title }) {
  return (
    <button className={`wt-check ${done ? 'on' : ''}`} onClick={onClick} title={title} aria-pressed={done}>
      {done && <Check size={13} />}
    </button>
  );
}

function Section({ id, icon: Icon, title, extra, children, open, onToggle, done }) {
  return (
    <section className={`wt-section ${done ? 'wt-done' : ''}`}>
      <div className="wt-head">
        <button className="wt-toggle" onClick={() => onToggle(id)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <Icon size={15} />
          <h3>{title}</h3>
        </button>
        {extra}
      </div>
      {open && <div className="wt-body">{children}</div>}
    </section>
  );
}

function Round({ kind, round, now, open, onToggle, checks }) {
  const t = useT();
  if (!round) return null;
  const done = checks[kind] === round.id;
  const isSortie = kind === 'sortie';
  return (
    <Section
      id={kind}
      icon={isSortie ? Swords : Skull}
      title={t(isSortie ? 'Sortie' : 'Archon-Jagd')}
      open={open}
      onToggle={onToggle}
      done={done}
      extra={
        <div className="wt-extra">
          <span className="wt-time">{countdown(round.expiry, now)}</span>
          <DoneBox
            done={done}
            onClick={() => toggleRound(kind, round.id)}
            title={t(isSortie ? 'Heute erledigt' : 'Diese Woche erledigt')}
          />
        </div>
      }
    >
      <div className="wt-boss">
        <b>{round.boss}</b>
        {round.faction && <span className="muted"> · {round.faction}</span>}
        {round.shard && (
          <span className={`wt-shard wt-shard-${round.shard}`}>
            <Gem size={12} /> {t(SHARD[round.shard])}
          </span>
        )}
      </div>
      <ol className="wt-missions">
        {round.missions.map((m, i) => (
          <li key={i}>
            <div>
              <b>{m.missionType}</b> <span className="muted">({m.node})</span>
            </div>
            {m.modifier && (
              <div className="wt-mod" title={m.modifierDesc}>
                {m.modifier}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Nightwave({ nw, now, open, onToggle, checks }) {
  const t = useT();
  const ids = nw.challenges.map((c) => c.id);
  useEffect(() => pruneChallenges(ids), [ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = new Set(checks.nw);
  const doneCount = ids.filter((id) => done.has(id)).length;
  const standing = nw.challenges.reduce((sum, c) => sum + (done.has(c.id) ? c.standing : 0), 0);
  const total = nw.challenges.reduce((sum, c) => sum + c.standing, 0);
  return (
    <Section
      id="nightwave"
      icon={Radio}
      title={t('Nightwave')}
      open={open}
      onToggle={onToggle}
      done={ids.length > 0 && doneCount === ids.length}
      extra={
        <div className="wt-extra">
          <span className="wt-count">{t('{n}/{m} erledigt', { n: doneCount, m: ids.length })}</span>
          <span className="wt-time">{countdown(nw.expiry, now)}</span>
        </div>
      }
    >
      <div className="wt-standing muted small">
        {t('Ansehen: {n} / {m}', { n: standing.toLocaleString('de-DE'), m: total.toLocaleString('de-DE') })}
      </div>
      {KINDS.map(([kind, label]) => {
        const list = nw.challenges.filter((c) => c.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="wt-group">
            <h4>{t(label)}</h4>
            <ul>
              {list.map((c) => {
                const on = done.has(c.id);
                return (
                  <li key={c.id} className={on ? 'wt-done' : ''}>
                    <DoneBox done={on} onClick={() => toggleChallenge(c.id, ids)} title={t(on ? 'Als offen markieren' : 'Als erledigt markieren')} />
                    <div className="wt-chal">
                      <b>{c.title}</b>
                      {c.desc && <div className="muted">{c.desc}</div>}
                    </div>
                    <div className="wt-chal-side">
                      <span className="wt-rep">+{c.standing.toLocaleString('de-DE')}</span>
                      <span className="wt-time muted">{countdown(c.expiry, now)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </Section>
  );
}

export default function WorldTasks({ world, now }) {
  const t = useT();
  const checks = useWorldChecks();
  const [open, setOpen] = useState(() => load(OPEN_KEY, { sortie: true, archon: true, nightwave: true }));
  const toggle = (id) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      save(OPEN_KEY, next);
      return next;
    });
  const live = (r) => (r && new Date(r.expiry).getTime() > now ? r : null);
  const sortie = live(world.sortie);
  const archon = live(world.archon);
  const nw = live(world.nightwave);

  if (!world.time) return <p className="muted small">{t('Lade Weltstatus …')}</p>;
  return (
    <div className="wt">
      <Round kind="sortie" round={sortie} now={now} open={!!open.sortie} onToggle={toggle} checks={checks} />
      <Round kind="archon" round={archon} now={now} open={!!open.archon} onToggle={toggle} checks={checks} />
      {nw && <Nightwave nw={nw} now={now} open={!!open.nightwave} onToggle={toggle} checks={checks} />}
      {!sortie && !archon && !nw && <p className="muted small">{t('Gerade keine Sortie, Archon-Jagd oder Nightwave.')}</p>}
    </div>
  );
}

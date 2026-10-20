import { useEffect, useState } from 'react';
import { Globe, Infinity as All, ChevronUp, ChevronsUp, Rocket, ScanLine, PanelRightClose, ListChecks } from 'lucide-react';
import { getWorldState } from '../lib/api.js';
import { countdown } from '../lib/format.js';
import { useNow } from '../lib/useNow.js';
import RelicIcon from './RelicIcon.jsx';
import ScanTab, { useLastScan } from './ScanTab.jsx';
import WorldTasks from './WorldTasks.jsx';
import { useWorldNotifications } from '../lib/notify.js';
import FoundryTimers from './FoundryTimers.jsx';
import { useFoundryNotifications } from '../lib/foundry.js';
import { useT } from '../lib/i18n.js';

const REFRESH_MS = 60_000;

const CYCLES = [
  { key: 'earth', place: 'Erde', planet: 'earth' },
  { key: 'cetus', place: 'Cetus', planet: 'earth' },
  { key: 'vallis', place: 'Vallis', planet: 'venus' },
  { key: 'cambion', place: 'Cambion', planet: 'deimos' },
];

const STATE_DE = { day: 'TAG', night: 'NACHT', warm: 'WARM', cold: 'KALT', fass: 'FASS', vome: 'VOME' };
const TIERS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Omnia'];

function useWorld() {
  const [world, setWorld] = useState({});
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getWorldState()
        .then((w) => alive && setWorld(w))
        .catch(() => {}); // beim nächsten Durchlauf erneut versuchen, alte Daten bleiben stehen
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return world;
}

function BaroBadge({ baro, now }) {
  const t = useT();
  if (!baro) return null;
  const active = new Date(baro.activation).getTime() <= now;
  return (
    <span className="pill pill-teal">
      {active ? t('Baro geht in {t}', { t: countdown(baro.expiry, now) }) : t('Baro kommt in {t}', { t: countdown(baro.activation, now) })}
    </span>
  );
}

function Fissures({ fissures, now }) {
  const [mode, setMode] = useState('normal'); // all | normal | hard | storm
  const list = fissures
    .filter((f) => new Date(f.expiry).getTime() > now)
    .filter((f) =>
      mode === 'all' ? true : mode === 'hard' ? f.isHard : mode === 'storm' ? f.isStorm : !f.isHard && !f.isStorm,
    )
    .sort((a, b) => a.tierNum - b.tierNum || new Date(a.expiry) - new Date(b.expiry));

  const tr = useT();
  const modes = [
    { id: 'all', icon: All, title: 'Alle' },
    { id: 'normal', icon: ChevronUp, title: 'Normal' },
    { id: 'hard', icon: ChevronsUp, title: 'Steel Path' },
    { id: 'storm', icon: Rocket, title: 'Void-Sturm (Railjack)' },
  ];

  const byTier = TIERS.map((t) => [t, list.filter((f) => f.tier === t)]).filter(([, l]) => l.length);

  return (
    <section className="fissures">
      <div className="fissures-head">
        <h3>{tr('Void-Spalten')}</h3>
        <div className="seg">
          {modes.map(({ id, icon: Icon, title }) => (
            <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)} title={tr(title)}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      {byTier.length === 0 && <p className="muted small">{tr('Keine Spalten in dieser Ansicht.')}</p>}
      {byTier.map(([tier, items]) => (
        <div key={tier} className="fissure-tier">
          <RelicIcon tier={tier} size={30} />
          <ul>
            {items.map((f) => (
              <li key={f.id}>
                <span className="fissure-mission">
                  {f.isHard && <ChevronsUp size={12} className="sp" />}
                  <b>{f.missionType}</b> <span className="muted">({f.node})</span>
                </span>
                <span className="fissure-time">{countdown(f.expiry, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function TimerPanel({ open = true, onToggle }) {
  const [tab, setTab] = useState('timers');
  const world = useWorld();
  const now = useNow();
  const scan = useLastScan();
  const t = useT();
  useWorldNotifications(world, now);
  useFoundryNotifications(now);

  // Neues Scan-Ergebnis -> Tab "Relikte" zeigen (Panel bleibt so, wie der Nutzer es eingestellt hat)
  useEffect(() => {
    if (scan && scan.reason !== 'button' && (scan.mode === 'rewards' || scan.mode === 'selection')) setTab('scan');
  }, [scan]);

  // Eingeklappt: ganz ausgeblendet (Aufklappen über die Titelleiste). Die Komponente bleibt aktiv,
  // damit Timer-Benachrichtigungen und Scan-Ergebnisse weiterlaufen.
  if (!open) return null;

  return (
    <aside className="timerpanel">
      <div className="tabs">
        <button className={tab === 'timers' ? 'active' : ''} onClick={() => setTab('timers')}>
          <Globe size={16} /> {t('Timer')}
        </button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
          <ListChecks size={16} /> {t('Aufgaben')}
        </button>
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
          <ScanLine size={16} /> {t('Relikte')}
        </button>
        <button className="tabs-collapse" onClick={() => onToggle?.(false)} title={t('Panel einklappen')}>
          <PanelRightClose size={16} />
        </button>
      </div>

      {tab === 'scan' ? (
        <ScanTab result={scan} />
      ) : tab === 'tasks' ? (
        <div className="timer-scroll">
          <WorldTasks world={world} now={now} />
        </div>
      ) : (
        <div className="timer-scroll">
          <div className="badges">
            <BaroBadge baro={world.baro} now={now} />
          </div>
          <div className="cycles">
            {CYCLES.map(({ key, place, planet }) => {
              const c = world[key];
              return (
                <div key={key} className="cycle">
                  <span className={`planet planet-${planet}`} />
                  <div>
                    <div className="cycle-state">
                      <small>{t(place).toUpperCase()}</small> <b>{c ? t(STATE_DE[c.state] ?? c.state.toUpperCase()) : '…'}</b>
                    </div>
                    <div className="cycle-time">{c ? countdown(c.expiry, now) : '–'}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <FoundryTimers now={now} />
          <Fissures fissures={world.fissures ?? []} now={now} />
        </div>
      )}
    </aside>
  );
}

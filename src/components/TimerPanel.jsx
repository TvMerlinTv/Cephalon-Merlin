// Panel rechts: Timer (Zyklen, Baro, Spalten), Aufgaben (Sortie, Archon, Nightwave) und Relikte (letzter Scan).
// Benachrichtigungen laufen im Rust-Teil – das Panel darf also ruhig eingeklappt sein.
import { createEffect, createSignal, Match, on as onChange, Switch } from 'solid-js';
import { Globe, ListChecks, ScanLine, PanelRightClose } from 'lucide-solid';
import { BaroBadge, Cycles, Fissures, WorldTasks } from './WorldWidgets.jsx';
import ScanTab, { lastScan } from './ScanTab.jsx';
import FoundryTimers from './FoundryTimers.jsx';
import { t } from '../lib/i18n.js';
import { load, save } from '../lib/ipc.js';

export default function TimerPanel(props) {
  const [tab, setTab] = createSignal(load('cm.panel.tab', 'timers'));
  const pick = (v) => {
    setTab(v);
    save('cm.panel.tab', v);
  };
  // Neues Scan-Ergebnis aus dem Spiel -> Tab "Relikte" zeigen
  createEffect(
    onChange(lastScan, (scan) => {
      if (scan && scan.reason !== 'button' && (scan.mode === 'rewards' || scan.mode === 'selection')) setTab('scan');
    }, { defer: true }),
  );
  return (
    <aside class="timerpanel">
      <div class="tabs">
        <button classList={{ active: tab() === 'timers' }} onClick={() => pick('timers')}>
          <Globe size={16} /> {t('Timer')}
        </button>
        <button classList={{ active: tab() === 'tasks' }} onClick={() => pick('tasks')}>
          <ListChecks size={16} /> {t('Aufgaben')}
        </button>
        <button classList={{ active: tab() === 'scan' }} onClick={() => pick('scan')}>
          <ScanLine size={16} /> {t('Relikte')}
        </button>
        <button class="tabs-collapse" onClick={() => props.onCollapse?.()} title={t('Panel einklappen')}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <Switch>
        <Match when={tab() === 'scan'}>
          <ScanTab />
        </Match>
        <Match when={tab() === 'tasks'}>
          <div class="timer-scroll">
            <WorldTasks />
          </div>
        </Match>
        <Match when={true}>
          <div class="timer-scroll">
            <div class="badges">
              <BaroBadge />
            </div>
            <Cycles />
            <FoundryTimers />
            <Fissures />
          </div>
        </Match>
      </Switch>
    </aside>
  );
}

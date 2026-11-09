import { createSignal, Match, Show, Switch } from 'solid-js';
import { PanelRightOpen, PanelRightClose } from 'lucide-solid';
import TitleBar from './components/TitleBar.jsx';
import { UpdateBadge } from './components/UpdateNotice.jsx';
import Sidebar, { NAV } from './components/Sidebar.jsx';
import Settings from './components/Settings.jsx';
import ConfirmClose from './components/ConfirmClose.jsx';
import MaterialInfo from './components/MaterialInfo.jsx';
import SyncBadge from './components/SyncBadge.jsx';
import TimerPanel from './components/TimerPanel.jsx';
import Help from './pages/Help.jsx';
import Inventory from './pages/Inventory.jsx';
import World from './pages/World.jsx';
import Relics from './pages/Relics.jsx';
import Mastery from './pages/Mastery.jsx';
import Rivens from './pages/Rivens.jsx';
import Market from './pages/Market.jsx';
import Trade from './pages/Trade.jsx';
import Builds from './pages/Builds.jsx';
import Stats from './pages/Stats.jsx';
import Foundry from './pages/Foundry.jsx';
import { useBaroDucatReminder } from './lib/baroDucats.js';
import Soon from './pages/Soon.jsx';
import { load, save } from './lib/ipc.js';
import { useTheme } from './lib/theme.js';
import { t } from './lib/i18n.js';

export default function App() {
  const [page, setPage] = createSignal(load('cm.page', 'inventory'));
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  // Timer-Panel rechts einklappbar (gemerkt); auf der Weltstatus-Seite wäre es doppelt
  const [panelOpen, setPanelOpen] = createSignal(load('cm.panel.open', true));
  const togglePanel = (open) => {
    setPanelOpen(open);
    save('cm.panel.open', open);
  };
  const showPanel = () => panelOpen() && page() !== 'world';
  useTheme();
  useBaroDucatReminder();

  const go = (p) => {
    // Einstellungen sind ein Fenster über der aktuellen Seite
    if (p === 'settings') return setSettingsOpen(true);
    setPage(p);
    save('cm.page', p);
  };
  window.addEventListener('cm:navigate', (e) => go(e.detail));
  const label = () => NAV.find((n) => n.id === page())?.label ?? '';

  const panelButton = (
    <Show when={page() !== 'world'}>
      <button
        class="panel-toggle"
        classList={{ active: panelOpen() }}
        onClick={() => togglePanel(!panelOpen())}
        title={t(panelOpen() ? 'Timer/Relikte ausblenden' : 'Timer/Relikte einblenden')}
      >
        {panelOpen() ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
      </button>
    </Show>
  );

  return (
    <div class="app">
      <TitleBar left={<><SyncBadge /><UpdateBadge /></>} right={panelButton} />
      <div class="body" classList={{ 'panel-collapsed': !showPanel() }}>
        <Sidebar page={settingsOpen() ? 'settings' : page()} onNavigate={go} />
        <main class="content">
          <Switch fallback={<Soon label={label()} />}>
            <Match when={page() === 'inventory'}>
              <Inventory />
            </Match>
            <Match when={page() === 'foundry'}>
              <Foundry />
            </Match>
            <Match when={page() === 'stats'}>
              <Stats />
            </Match>
            <Match when={page() === 'builds'}>
              <Builds />
            </Match>
            <Match when={page() === 'market'}>
              <Market />
            </Match>
            <Match when={page() === 'trade'}>
              <Trade />
            </Match>
            <Match when={page() === 'rivens'}>
              <Rivens />
            </Match>
            <Match when={page() === 'mastery'}>
              <Mastery />
            </Match>
            <Match when={page() === 'relics'}>
              <Relics />
            </Match>
            <Match when={page() === 'world'}>
              <World />
            </Match>
            <Match when={page() === 'help'}>
              <Help onNavigate={go} />
            </Match>
          </Switch>
        </main>
        <Show when={showPanel()}>
          <TimerPanel onCollapse={() => togglePanel(false)} />
        </Show>
      </div>
      {settingsOpen() && <Settings onClose={() => setSettingsOpen(false)} />}
      <MaterialInfo />
      <ConfirmClose />
    </div>
  );
}

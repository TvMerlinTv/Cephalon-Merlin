import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { PanelRightOpen, PanelRightClose, Search } from 'lucide-solid';
import TitleBar from './components/TitleBar.jsx';
import { UpdateBadge } from './components/UpdateNotice.jsx';
import NetBadge from './components/NetBadge.jsx';
import Sidebar, { NAV } from './components/Sidebar.jsx';
import Settings from './components/Settings.jsx';
import ConfirmClose from './components/ConfirmClose.jsx';
import MaterialInfo from './components/MaterialInfo.jsx';
import SyncBadge from './components/SyncBadge.jsx';
import TimerPanel from './components/TimerPanel.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Welcome from './components/Welcome.jsx';
import ItemDetails from './components/ItemDetails.jsx';
import Home from './pages/Home.jsx';
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
import { visibleNav } from './lib/nav.js';
import { syncGame } from './lib/game.js';
import { useTheme } from './lib/theme.js';
import './magic.css';
import { t } from './lib/i18n.js';

// Erster Start überhaupt: noch keine Seite gemerkt und der Dialog noch nie geschlossen
const FIRST_START = load('cm.page', null) === null && !load('cm.welcome.v1', false);

export default function App() {
  const [welcome, setWelcome] = createSignal(FIRST_START);
  const closeWelcome = () => {
    setWelcome(false);
    save('cm.welcome.v1', true);
  };
  const [page, setPage] = createSignal(load('cm.page', 'home'));
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

  // Globale Suche (Strg+K) und ein Item-Fenster, das von überall geöffnet werden kann
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [details, setDetails] = createSignal(null);
  // Tastenkürzel: Strg+K Suche · Strg+1…9 Seiten (Reihenfolge der Seitenleiste) · Strg+, Einstellungen · F5 Sync
  const onKey = (e) => {
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (ctrl && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    } else if (ctrl && e.key === ',') {
      e.preventDefault();
      setSettingsOpen(true);
    } else if (ctrl && /^[1-9]$/.test(e.key)) {
      const target = visibleNav(NAV)[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        go(target.id);
      }
    } else if (e.key === 'F5' && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); // sonst lädt das Fenster die Oberfläche neu
      syncGame();
    }
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  const panelButton = (
    <>
      <button class="search-open" onClick={() => setPaletteOpen(true)} title={t('Seite, Item oder Aktion suchen …')}>
        <Search size={14} /> {t('Suchen')} <kbd>{t('Strg')}+K</kbd>
      </button>
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
    </>
  );

  return (
    <div class="app">
      <TitleBar left={<><SyncBadge /><NetBadge /><UpdateBadge /></>} right={panelButton} />
      <div class="body" classList={{ 'panel-collapsed': !showPanel() }}>
        <Sidebar page={settingsOpen() ? 'settings' : page()} onNavigate={go} />
        <main class="content">
          <Switch fallback={<Soon label={label()} />}>
            <Match when={page() === 'home'}>
              <Home onNavigate={go} onItem={setDetails} />
            </Match>
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
      <Show when={details()}>
        <ItemDetails item={details().item} partId={details().partId} marketItem={details().marketItem} onClose={() => setDetails(null)} />
      </Show>
      <Show when={welcome()}>
        <Welcome onClose={closeWelcome} />
      </Show>
      <Show when={paletteOpen()}>
        <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={go} onItem={setDetails} />
      </Show>
      <MaterialInfo />
      <ConfirmClose />
    </div>
  );
}

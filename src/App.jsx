import { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TimerPanel from './components/TimerPanel.jsx';
import Inventory from './pages/Inventory.jsx';
import Mastery from './pages/Mastery.jsx';
import Market from './pages/Market.jsx';
import Relics from './pages/Relics.jsx';
import Foundry from './pages/Foundry.jsx';
import Rivens from './pages/Rivens.jsx';
import Stats from './pages/Stats.jsx';
import Trade from './pages/Trade.jsx';
import Builds from './pages/Builds.jsx';
import Settings from './components/Settings.jsx';
import Help from './pages/Help.jsx';
import { load, save } from './lib/api.js';
import { useTheme } from './lib/theme.js';
import { usePriceAlertChecker } from './lib/priceAlerts.js';


export default function App() {
  const [page, setPage] = useState(() => {
    const p = load('td.page', 'inventory');
    return p === 'settings' ? 'inventory' : p;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Timer/Relikte-Panel rechts einklappbar (gemerkt)
  const [panelOpen, setPanelOpen] = useState(() => load('td.panel.open', true));
  const togglePanel = (open) => {
    setPanelOpen(open);
    save('td.panel.open', open);
  };
  useTheme();
  usePriceAlertChecker(); // Preis-Alarme: kurz nach dem Start + alle X Minuten

  const go = (p) => {
    // Einstellungen sind ein Fenster über der aktuellen Seite
    if (p === 'settings') return setSettingsOpen(true);
    setPage(p);
    save('td.page', p);
  };
  // Andere Seiten können hierher springen (z. B. „Builds“ aus den Item-Details, src/lib/builds.js)
  useEffect(() => {
    const onNav = (e) => go(e.detail);
    window.addEventListener('cm:navigate', onNav);
    return () => window.removeEventListener('cm:navigate', onNav);
  }, []);

  let content;
  if (page === 'inventory') content = <Inventory />;
  else if (page === 'mastery') content = <Mastery />;
  else if (page === 'market') content = <Market />;
  else if (page === 'relics') content = <Relics />;
  else if (page === 'foundry') content = <Foundry />;
  else if (page === 'rivens') content = <Rivens />;
  else if (page === 'stats') content = <Stats />;
  else if (page === 'trade') content = <Trade />;
  else if (page === 'builds') content = <Builds />;
  else content = <Help onNavigate={go} />;

  return (
    <div className="app">
      <TitleBar panelOpen={panelOpen} onTogglePanel={() => togglePanel(!panelOpen)} />
      <div className={`body ${panelOpen ? '' : 'panel-collapsed'}`}>
        <Sidebar page={settingsOpen ? 'settings' : page} onNavigate={go} />
        <main className="content">{content}</main>
        <TimerPanel open={panelOpen} onToggle={togglePanel} />
      </div>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

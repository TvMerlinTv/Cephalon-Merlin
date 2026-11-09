import { render } from 'solid-js/web';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.jsx';
import Overlay from './pages/Overlay.jsx';
import { initSettings } from './lib/settings.js';
import { isTauri, logError } from './lib/ipc.js';
import './styles.css';
import './rs.css';

// Das Overlay-Fenster lädt dieselbe Seite mit "#overlay"
const isOverlay = window.location.hash.startsWith('#overlay');

// Erst Einstellungen laden (Sprache, Theme), dann zeichnen und das Fenster zeigen –
// so gibt es kein Aufblitzen in falschen Farben. Das Overlay zeigt und versteckt der Rust-Teil.
initSettings()
  .catch((e) => logError('settings', e))
  .finally(() => {
    render(() => (isOverlay ? <Overlay /> : <App />), document.getElementById('root'));
    if (isTauri && !isOverlay) requestAnimationFrame(() => getCurrentWindow().show());
  });

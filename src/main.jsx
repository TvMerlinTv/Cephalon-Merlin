import { render } from 'solid-js/web';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initSettings } from './lib/settings.js';
import { isTauri, logError } from './lib/ipc.js';
import './styles.css';
import './rs.css';

// Das Overlay-Fenster lädt dieselbe Seite mit "#overlay"
const isOverlay = window.location.hash.startsWith('#overlay');

// Jedes Fenster lädt nur seinen Teil: das Overlay braucht die Seiten der Haupt-App nicht
// (weniger Speicher, schnellerer Start des Overlays).
const page = isOverlay ? import('./pages/Overlay.jsx') : import('./App.jsx');

// Erst Einstellungen laden (Sprache, Theme), dann zeichnen und das Fenster zeigen –
// so gibt es kein Aufblitzen in falschen Farben. Das Overlay zeigt und versteckt der Rust-Teil.
Promise.all([page, initSettings().catch((e) => logError('settings', e))])
  .then(([mod]) => {
    const Page = mod.default;
    render(() => <Page />, document.getElementById('root'));
  })
  .catch((e) => logError('start', e))
  .finally(() => {
    if (isTauri && !isOverlay) requestAnimationFrame(() => getCurrentWindow().show());
  });

// Bilder, die nicht laden (z. B. neues Item ohne Bild beim Anbieter): kein weißer Kasten, sondern leer.
// Capture-Phase, weil error/load bei <img> nicht aufsteigen. Lädt später doch ein Bild, wird es wieder gezeigt.
document.addEventListener('error', (e) => e.target instanceof HTMLImageElement && e.target.classList.add('img-broken'), true);
document.addEventListener('load', (e) => e.target instanceof HTMLImageElement && e.target.classList.remove('img-broken'), true);

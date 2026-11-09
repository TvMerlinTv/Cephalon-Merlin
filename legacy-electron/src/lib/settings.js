import { useEffect, useState } from 'react';
import { isElectron, load, save } from './api.js';

// Einstellungen: in Electron aus settings.json (Main-Prozess, für alle Fenster gleich),
// im Browser-Testmodus aus localStorage.

export const DEFAULTS = {
  language: 'de',
  theme: 'default',
  accent: '',
  colors: {}, // einzelne Farben überschreiben: { bg: '#000000', … }
  radius: 12, // Eckenrundung in px
  uiScale: 1, // Größe der ganzen Oberfläche
  confirmClose: true,
  hideFounders: false,
  secondMonitor: false,
  autoSync: false, // automatisch mit dem Spiel synchronisieren
  autoSyncMission: true, // … nach jeder Mission
  autoSyncMinutes: 0, // … alle X Minuten (0 = aus, sonst 5–120)
  rewardsOverlay: true,
  selectionOverlay: true,
  walletOnOverlay: true,
  copyRewards: false,
  rewardsScale: 1.2,
  hotkey: 'Home',
  notify: true,
  notifyCycles: { earth: false, cetus: true, vallis: false, cambion: false },
  notifyMinutes: 3,
  notifyBaro: true,
  notifyBaroDucats: true,
  notifySortie: false,
  notifyArchon: false,
  notifyFoundry: true, // Foundry-Bauauftrag fertig (src/lib/foundry.js)
  notifyPriceAlerts: true, // Preis-Alarme (src/lib/priceAlerts.js)
  priceAlertMinutes: 10, // 5 / 10 / 15 / 30
};
export const HOTKEYS = ['Home', 'End', 'Insert', 'PageUp', 'PageDown', 'F9', 'F10', 'F11', 'F12', 'ScrollLock', 'Pause'];
// Beschriftung wie auf einer deutschen Tastatur
export const KEY_LABELS = { Home: 'Pos1', End: 'Ende', Insert: 'Einfg', PageUp: 'Bild ↑', PageDown: 'Bild ↓', ScrollLock: 'Rollen' };
export const keyLabel = (k, language = current.language) => (language === 'de' ? KEY_LABELS[k] : null) ?? k;

const KEY = 'td.settings.v1';
let current = { ...DEFAULTS, ...(isElectron ? {} : load(KEY, {})) };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(current));

if (isElectron) {
  window.wf.getSettings?.().then(({ values }) => {
    current = { ...DEFAULTS, ...values };
    emit();
  });
  window.wf.onSettings?.((values) => {
    current = { ...DEFAULTS, ...values };
    emit();
  });
}

export function getSettings() {
  return current;
}

export async function setSettings(patch) {
  if (isElectron) {
    current = { ...DEFAULTS, ...(await window.wf.setSettings(patch)) };
  } else {
    current = { ...current, ...patch };
    save(KEY, current);
  }
  emit();
}

export function useSettings() {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

// Founders-Programm: nie wieder erhältlich – auf Wunsch überall ausblenden
const FOUNDERS = new Set(['Excalibur Prime', 'Skana Prime', 'Lato Prime']);
export const isFounders = (item) => FOUNDERS.has(item.name);

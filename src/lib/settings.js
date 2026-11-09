// Einstellungen: in der Desktop-App aus settings.json (Rust-Teil, für alle Fenster gleich),
// im Browser-Testmodus aus localStorage. `settings` ist ein reaktiver Solid-Store:
// wer settings.language liest, wird bei Änderungen automatisch neu gezeichnet.
import { createStore, reconcile } from 'solid-js/store';
import { call, isTauri, load, on, save } from './ipc.js';

export const DEFAULTS = {
  language: 'de',
  theme: 'default',
  accent: '',
  colors: {},
  radius: 12,
  uiScale: 1,
  confirmClose: true,
  hideFounders: false,
  secondMonitor: false,
  autoSync: false,
  autoSyncMission: true,
  autoSyncMinutes: 0,
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
  notifyFoundry: true,
  notifyPriceAlerts: true,
  priceAlertMinutes: 10,
  discordRpc: false,
  discordAppId: '',
  discordShowMr: true,
  discordShowActivity: true,
  discordShowName: false,
  discordIdle: false,
  discordButton: true,
  discordHooks: { priceAlert: true, foundry: true, baro: true, world: false },
};
export const HOTKEYS = ['Home', 'End', 'Insert', 'PageUp', 'PageDown', 'F9', 'F10', 'F11', 'F12', 'ScrollLock', 'Pause'];
const KEY_LABELS = { Home: 'Pos1', End: 'Ende', Insert: 'Einfg', PageUp: 'Bild ↑', PageDown: 'Bild ↓', ScrollLock: 'Rollen' };
export const keyLabel = (k, language) => (language === 'de' ? KEY_LABELS[k] : null) ?? k;

const KEY = 'cm.settings.v1';
const [settings, setStore] = createStore({ ...DEFAULTS, ...(isTauri ? {} : load(KEY, {})) });
export { settings };

const apply = (values) => setStore(reconcile({ ...DEFAULTS, ...values }));

/** Lädt die Einstellungen aus dem Rust-Teil (vor dem ersten Zeichnen aufrufen). */
export async function initSettings() {
  if (!isTauri) return;
  const { values } = await call('settings_get');
  apply(values);
  on('settings-changed', apply);
}

export async function setSettings(patch) {
  if (isTauri) {
    apply(await call('settings_set', { patch }));
  } else {
    setStore(patch);
    save(KEY, { ...settings });
  }
}

// Founders-Programm: nie wieder erhältlich – auf Wunsch überall ausblenden
const FOUNDERS = new Set(['Excalibur Prime', 'Skana Prime', 'Lato Prime']);
export const isFounders = (item) => FOUNDERS.has(item.name);

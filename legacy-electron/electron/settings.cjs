// Einstellungen der App: settings.json im Datenordner, geteilt von Hauptfenster, Overlay und Main-Prozess.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  // Allgemein
  language: 'de', // 'de' oder 'en'
  theme: 'default',
  accent: '',
  colors: {}, // einzelne Farben überschreiben: { bg: '#000000', … }
  radius: 12, // Eckenrundung in px
  uiScale: 1, // Größe der ganzen Oberfläche
  confirmClose: true, // Nachfrage beim Schließen des Hauptfensters
  hideFounders: false, // Excalibur Prime, Skana Prime, Lato Prime ausblenden
  secondMonitor: false, // beim Start auf den zweiten Monitor verschieben
  autoSync: false, // automatisch mit dem Spiel synchronisieren (Speicherscan erzeugt Last -> aus)
  autoSyncMission: true, // … nach jeder Mission (nur wenn autoSync an)
  autoSyncMinutes: 0, // … alle X Minuten: 0 = aus, sonst 5–120
  // Overlays
  rewardsOverlay: true, // Belohnungs-Overlay nach einer Spalten-Mission
  selectionOverlay: true, // Empfehlungen + Zahlen in der Relikt-Auswahl
  walletOnOverlay: true, // Platin/Ducats des Kontos im Belohnungs-Overlay
  copyRewards: false, // Belohnungs-Infos in die Zwischenablage kopieren
  rewardsScale: 1.2, // Größe des Belohnungs-Overlays
  hotkey: 'Home', // Taste für "Jetzt scannen"
  // Benachrichtigungen
  notify: true, // Windows-Benachrichtigungen
  notifyCycles: { earth: false, cetus: true, vallis: false, cambion: false },
  notifyMinutes: 3, // so viele Minuten vor dem Wechsel
  notifyBaro: true, // Baro Ki'Teer kommt an
  notifyBaroDucats: true, // einige Stunden vorher: Ducats zum Opfern
  notifySortie: false, // neue Sortie (täglich)
  notifyArchon: false, // neue Archon-Jagd (wöchentlich)
  notifyFoundry: true, // Foundry-Bauauftrag fertig (src/lib/foundry.js)
  notifyPriceAlerts: true, // Preis-Alarme für warframe.market (src/lib/priceAlerts.js)
  priceAlertMinutes: 10, // Prüf-Intervall: 5, 10, 15 oder 30 Minuten
};

// Farb-Themes (Farben in src/lib/theme.js)
const THEMES = ['default', 'ocean', 'emerald', 'ember', 'orokin', 'kuva', 'midnight'];
const COLOR_KEYS = ['bg', 'bg2', 'panel', 'card', 'cardHover', 'line', 'text', 'muted', 'accent', 'accent2', 'ok', 'err', 'warn', 'red', 'green'];
const HOTKEYS = ['Home', 'End', 'Insert', 'PageUp', 'PageDown', 'F9', 'F10', 'F11', 'F12', 'ScrollLock', 'Pause'];

let file = null;
let current = { ...DEFAULTS };
const listeners = new Set();

function init(dataDir) {
  file = path.join(dataDir, 'settings.json');
  try {
    current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

const get = () => current;

/** Nur bekannte Schlüssel mit dem richtigen Typ übernehmen. */
function update(patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in DEFAULTS)) continue;
    const def = DEFAULTS[key];
    if (key === 'colors') {
      // nur bekannte Farb-Schlüssel mit #rrggbb; '' = zurück zum Theme
      if (typeof value !== 'object' || !value) continue;
      next.colors = {};
      for (const [k, v] of Object.entries(value)) if (COLOR_KEYS.includes(k) && /^#[0-9a-f]{6}$/i.test(v)) next.colors[k] = v;
      continue;
    }
    if (typeof def === 'object' && def && typeof value === 'object' && value) {
      next[key] = { ...current[key] };
      for (const k of Object.keys(def)) if (typeof value[k] === 'boolean') next[key][k] = value[k];
    } else if (typeof value === typeof def) {
      next[key] = value;
    }
  }
  if (!HOTKEYS.includes(next.hotkey)) next.hotkey = DEFAULTS.hotkey;
  if (!['de', 'en'].includes(next.language)) next.language = DEFAULTS.language;
  if (!THEMES.includes(next.theme)) next.theme = DEFAULTS.theme;
  if (next.accent && !/^#[0-9a-f]{6}$/i.test(next.accent)) next.accent = '';
  next.rewardsScale = Math.min(1.6, Math.max(0.8, next.rewardsScale));
  next.radius = Math.min(20, Math.max(0, Math.round(next.radius)));
  next.uiScale = Math.min(2, Math.max(0.01, Math.round(next.uiScale * 100) / 100));
  next.notifyMinutes = Math.min(30, Math.max(0, Math.round(next.notifyMinutes)));
  if (![5, 10, 15, 30].includes(next.priceAlertMinutes)) next.priceAlertMinutes = DEFAULTS.priceAlertMinutes;
  const sm = Math.round(next.autoSyncMinutes) || 0;
  next.autoSyncMinutes = sm <= 0 ? 0 : Math.min(120, Math.max(5, sm));
  const prev = current;
  current = next;
  if (file) fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
  for (const fn of listeners) fn(current, prev);
  return current;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { init, get, update, onChange, DEFAULTS, HOTKEYS };

// Farb-Themes: setzen die CSS-Variablen aus styles.css (:root) neu.
// Jede Farbe kann zusätzlich einzeln überschrieben werden (Einstellung "colors"),
// die Akzentfarbe auch über "accent" (Schnellwahl). Dazu Eckenrundung und UI-Größe.
import { useEffect, useRef, useState } from 'react';
import { useSettings, setSettings } from './settings.js';

export const THEMES = [
  { id: 'default', label: 'Void (Standard)', colors: { bg: '#0f1219', bg2: '#151a25', panel: '#1a2030', card: '#222a3d', cardHover: '#29324a', line: '#2c3550', accent: '#6c4ce0' } },
  { id: 'ocean', label: 'Ozean', colors: { bg: '#0b1220', bg2: '#0f1a2b', panel: '#13203a', card: '#1a2a48', cardHover: '#213458', line: '#263b60', accent: '#2f7de1' } },
  { id: 'emerald', label: 'Smaragd', colors: { bg: '#0b1512', bg2: '#101c18', panel: '#14231e', card: '#1b2e27', cardHover: '#223a31', line: '#2a4238', accent: '#22a06b' } },
  { id: 'ember', label: 'Glut', colors: { bg: '#160f0e', bg2: '#1d1412', panel: '#241815', card: '#2e1f1b', cardHover: '#392722', line: '#45302a', accent: '#e0603a' } },
  { id: 'orokin', label: 'Orokin', colors: { bg: '#12100b', bg2: '#19160f', panel: '#201c13', card: '#2a2418', cardHover: '#342d1e', line: '#3f3624', accent: '#c9a24a' } },
  { id: 'kuva', label: 'Kuva', colors: { bg: '#140b10', bg2: '#1b1016', panel: '#22141c', card: '#2d1a25', cardHover: '#38202e', line: '#442838', accent: '#d6336c' } },
  { id: 'midnight', label: 'Mitternacht (OLED)', colors: { bg: '#000000', bg2: '#07080b', panel: '#0c0e13', card: '#13161d', cardHover: '#1a1e27', line: '#232837', accent: '#8b6dff' } },
];

// Farben, die kein Theme ändert (Werte wie in styles.css :root)
const BASE = {
  text: '#e9edf7',
  muted: '#8d96ad',
  ok: '#3ccf8e',
  err: '#ff6b7d',
  warn: '#f2b84b',
  red: '#6e2433',
  green: '#1d5b43',
};

// Alle einzeln einstellbaren Farben: Schlüssel, CSS-Variable, Beschriftung, Gruppe
export const COLOR_KEYS = [
  { key: 'bg', css: '--bg', label: 'Hintergrund', group: 'Flächen' },
  { key: 'bg2', css: '--bg-2', label: 'Leisten & Eingabefelder', group: 'Flächen' },
  { key: 'panel', css: '--panel', label: 'Panels (Seitenleiste, Timer)', group: 'Flächen' },
  { key: 'card', css: '--card', label: 'Karten', group: 'Flächen' },
  { key: 'cardHover', css: '--card-hover', label: 'Karten beim Drüberfahren', group: 'Flächen' },
  { key: 'line', css: '--line', label: 'Linien & Rahmen', group: 'Flächen' },
  { key: 'text', css: '--text', label: 'Text', group: 'Text' },
  { key: 'muted', css: '--muted', label: 'Nebentext', group: 'Text' },
  { key: 'accent', css: '--accent', label: 'Akzent', group: 'Akzent' },
  { key: 'accent2', css: '--accent-2', label: 'Akzent hell (Rahmen, Punkte)', group: 'Akzent' },
  { key: 'ok', css: '--ok', label: 'Positiv (Buffs, Erfolg)', group: 'Status' },
  { key: 'err', css: '--err', label: 'Negativ (Curses, Fehler)', group: 'Status' },
  { key: 'warn', css: '--warn', label: 'Warnung', group: 'Status' },
  { key: 'red', css: '--red', label: 'WTS (Verkaufen)', group: 'Markt' },
  { key: 'green', css: '--green', label: 'WTB (Kaufen)', group: 'Markt' },
];
const HEX = /^#[0-9a-f]{6}$/i;

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];

// Hellere Variante für Hover/Rahmen: 30 % Richtung Weiß
export function lighten(hex, amount = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (255 - c) * amount);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Endgültige Farben: Theme → Schnell-Akzent → einzelne Überschreibungen. */
export function resolveColors(s) {
  const own = s.colors ?? {};
  const out = { ...BASE, ...themeById(s.theme).colors };
  if (HEX.test(s.accent ?? '')) out.accent = s.accent;
  for (const { key } of COLOR_KEYS) if (HEX.test(own[key] ?? '')) out[key] = own[key];
  // Helles Akzent folgt dem Akzent, solange es nicht selbst eingestellt ist
  if (!HEX.test(own.accent2 ?? '')) out.accent2 = lighten(out.accent);
  return out;
}

export function applyTheme(s) {
  const colors = resolveColors(s);
  const root = document.documentElement.style;
  for (const { key, css } of COLOR_KEYS) root.setProperty(css, colors[key]);
  root.setProperty('--radius', `${s.radius ?? 12}px`);
  // UI-Größe per CSS-Zoom nur auf dem Hauptfenster (Electron-Zoom würde auch das Overlay treffen).
  // Breite/Höhe ausgleichen, damit die App trotzdem genau das Fenster füllt.
  const z = s.uiScale ?? 1;
  const app = document.getElementById('root').style;
  app.zoom = String(z);
  // Titelleiste (mit dem Größen-Regler) bleibt immer gleich groß – sonst sperrt man sich bei 1 % aus
  root.setProperty('--ui-zoom', String(z));
  app.width = z === 1 ? '' : `${100 / z}vw`;
  app.height = z === 1 ? '' : `${100 / z}vh`;
}

/** Wendet das eingestellte Aussehen an und folgt Änderungen (Hauptfenster). */
export function useTheme() {
  const s = useSettings();
  useEffect(() => applyTheme(s), [s.theme, s.accent, s.colors, s.radius, s.uiScale]);
}

// Für Farbwähler und Regler: beim Ziehen nur lokal anzeigen und kurz danach speichern –
// sonst setzt jede Antwort des Main-Prozesses den Wähler mitten im Ziehen zurück.
export function useDraftSave(s) {
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (patch) => {
    const next = { ...(draft ?? {}), ...patch };
    setDraft(next);
    applyTheme({ ...s, ...next });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await setSettings(next);
      setDraft(null);
    }, 300);
  };
  return [{ ...s, ...(draft ?? {}) }, change];
}


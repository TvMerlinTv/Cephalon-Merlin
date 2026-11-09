import { useEffect, useState } from 'react';
import { isElectron, load, save, getPrice } from './api.js';
import { useSettings, getSettings } from './settings.js';
import { openMarket } from './builds.js';
import { translate } from './i18n.js';

const tr = (text, vars) => translate(getSettings().language, text, vars);

// Preis-Alarme für warframe.market-Items.
// Gespeichert wie die To-Do-Liste: in der Desktop-App als alerts.json im Datenordner (Main-Prozess),
// localStorage bleibt Kopie und Browser-Fallback.
// Alarm: { id, slug, name, thumb, rank (null = ohne Rang), maxRank, kind: 'wts' | 'wtb', target,
//          enabled, created, price, checked, triggered, error }
// kind 'wts': günstigstes Verkaufsangebot ≤ target (billig kaufen); 'wtb': höchstes Kaufgebot ≥ target (gut verkaufen).
// Geprüft wird im Renderer über die Markt-Warteschlange (src/lib/api.js: Abstand + 429-Pausen).

const KEY = 'td.alerts.v1';
let alerts = load(KEY, []);
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(alerts));

if (isElectron && window.wf.storeGet) {
  window.wf.storeGet('alerts').then((stored) => {
    if (Array.isArray(stored)) {
      alerts = stored;
      save(KEY, alerts);
      emit();
    } else if (alerts.length) {
      window.wf.storeSet('alerts', alerts);
    }
  });
}

function set(next) {
  alerts = next;
  save(KEY, alerts);
  if (isElectron) window.wf.storeSet?.('alerts', alerts).catch(() => {});
  emit();
}
const patch = (id, p) => set(alerts.map((a) => (a.id === id ? { ...a, ...p } : a)));

export function addAlert({ item, kind, target, rank }) {
  const a = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    slug: item.slug,
    name: item.name,
    thumb: item.thumb ?? null,
    rank: item.maxRank ? Number(rank) || 0 : null,
    maxRank: item.maxRank ?? null,
    kind: kind === 'wtb' ? 'wtb' : 'wts',
    target: Math.max(1, Math.round(Number(target) || 1)),
    enabled: true,
    created: Date.now(),
    price: null,
    checked: null,
    triggered: false,
    error: null,
  };
  set([a, ...alerts]);
  checkAlerts([a.id]); // gleich einmal prüfen
  return a;
}
export const removeAlert = (id) => set(alerts.filter((a) => a.id !== id));
// Wieder einschalten = neu scharf (sonst bliebe ein alter Treffer stumm)
export const toggleAlert = (id) => {
  const a = alerts.find((x) => x.id === id);
  if (a) patch(id, a.enabled ? { enabled: false } : { enabled: true, triggered: false });
};

export function useAlerts() {
  const [s, setS] = useState(alerts);
  useEffect(() => {
    listeners.add(setS);
    setS(alerts);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

/** Bedingung als Text, z. B. „Verkaufsangebot ≤ 90p“ (deutsch; übersetzt über tr). */
export function conditionText(a) {
  return a.kind === 'wtb' ? tr('Kaufgebot ≥ {n}p', { n: a.target }) : tr('Verkaufsangebot ≤ {n}p', { n: a.target });
}
export const rankText = (a) => (a.rank == null ? '' : a.rank === a.maxRank ? tr('Max (Rang {n})', { n: a.rank }) : tr('Rang {n}', { n: a.rank }));

const hits = (a, price) => (price == null ? false : a.kind === 'wtb' ? price >= a.target : price <= a.target);

function notify(a, price) {
  const s = getSettings();
  if (!s.notify || !s.notifyPriceAlerts) return;
  try {
    if (Notification.permission === 'denied') return;
    const rank = a.rank != null ? ` · ${rankText(a)}` : '';
    const what = a.kind === 'wtb' ? tr('Kaufgebot') : tr('Verkaufsangebot');
    const op = a.kind === 'wtb' ? '≥' : '≤';
    const n = new Notification(`${tr('Preis-Alarm')}: ${a.name}${rank}`, {
      body: `${a.name}: ${what} ${price}p ${op} ${a.target}p`,
      silent: false,
    });
    n.onclick = () => {
      if (isElectron) window.wf.window('focus');
      else window.focus();
      openMarket(a.slug, a.rank);
    };
  } catch {
    /* Benachrichtigungen nicht verfügbar */
  }
}

let running = null;
/**
 * Prüft aktive Alarme nacheinander (ids = nur diese). Jedes Item/Rang wird nur einmal abgefragt.
 * Feuert nur beim Übergang „nicht erfüllt → erfüllt“; scharf wird es erst wieder, wenn der Preis zurück über die Grenze geht.
 */
export function checkAlerts(ids = null) {
  const run = async () => {
    const todo = alerts.filter((a) => a.enabled && (!ids || ids.includes(a.id)));
    const prices = new Map();
    for (const a of todo) {
      const key = `${a.slug}@${a.rank ?? 0}`;
      let price;
      try {
        if (!prices.has(key)) prices.set(key, await getPrice(a.slug, { force: true, rank: a.rank ?? 0 }));
        price = prices.get(key);
      } catch (e) {
        if (alerts.some((x) => x.id === a.id)) patch(a.id, { error: e.message, checked: Date.now() });
        continue;
      }
      const cur = alerts.find((x) => x.id === a.id);
      if (!cur || !cur.enabled) continue; // inzwischen gelöscht oder ausgeschaltet
      const value = cur.kind === 'wtb' ? price.wtb : price.wts;
      const hit = hits(cur, value);
      let triggered = cur.triggered;
      if (hit && !cur.triggered) {
        triggered = true;
        notify(cur, value);
      } else if (!hit && value != null) {
        triggered = false; // Preis wieder über/unter der Grenze -> neu scharf
      }
      patch(cur.id, { price: value, checked: Date.now(), triggered, error: null });
    }
  };
  // Läufe nacheinander, nie zwei gleichzeitig
  running = (running ?? Promise.resolve()).then(run, run);
  return running;
}

/** Einmal in der App einbinden: prüft kurz nach dem Start und dann alle X Minuten (Einstellung). */
export function usePriceAlertChecker() {
  const s = useSettings();
  const on = s.notifyPriceAlerts !== false;
  const minutes = s.priceAlertMinutes || 10;
  useEffect(() => {
    if (!on) return;
    const first = setTimeout(() => checkAlerts(), 5000);
    const timer = setInterval(() => checkAlerts(), minutes * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [on, minutes]);
}

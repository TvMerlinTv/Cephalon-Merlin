// Item-Datenbanken (Mastery, Relikte), Sammelpreise und To-Do-Liste – einmal laden, überall teilen.
import { createSignal } from 'solid-js';
import { call, isTauri } from './ipc.js';

function shared(load) {
  let p = null;
  return (force = false) => {
    if (!p || force) {
      p = load(force).catch((e) => {
        p = null;
        throw e;
      });
    }
    return p;
  };
}

/** Index: Item- oder Bauteil-ID (auch die Blaupausen-Variante) -> { item, part } */
function withIndex(db) {
  const index = new Map();
  for (const item of db.items) {
    index.set(item.id, { item, part: null });
    for (const part of item.components) {
      if (part.kind !== 'part') continue;
      for (const id of [part.id, part.id.replace(/Component$/, 'Blueprint')]) if (!index.has(id)) index.set(id, { item, part });
    }
  }
  return { ...db, index };
}

export const loadMasteryDb = shared((force) => call('mastery_db', { force }).then(withIndex));
export const loadRelicDb = shared((force) => call('relic_db', { force }));
export const loadBulkPrices = shared(() => call('bulk_prices'));

/** Fertig vorhanden: gebaute Bauteile, Blaupausen/Teile im Inventar, eigene Ausrüstung, Rohstoffe. */
export function builtCount(inv, id) {
  if (!inv) return 0;
  return (inv.counts[id] ?? 0) + (inv.owned[id] ?? 0);
}
/** Nur als Blaupause vorhanden: z. B. "Chassis-Blaupause" für ein noch nicht gebautes Chassis. */
export function blueprintOnlyCount(inv, id) {
  if (!inv || !id.endsWith('Component')) return 0;
  return inv.counts[id.replace(/Component$/, 'Blueprint')] ?? 0;
}

// ---------- To-Do-Liste (todo.json im Datenordner): Item-IDs in Reihenfolge ----------
const [todo, setTodoSignal] = createSignal([]);
export { todo };
if (isTauri) call('store_get', { key: 'todo' }).then((t) => Array.isArray(t) && setTodoSignal(t)).catch(() => {});
export function setTodo(next) {
  setTodoSignal(next);
  if (isTauri) call('store_set', { key: 'todo', value: next }).catch(() => {});
}
export const toggleTodo = (id) => setTodo(todo().includes(id) ? todo().filter((x) => x !== id) : [...todo(), id]);

// ---------- Relikt-Mathe ----------
/**
 * Erwarteter Wert, wenn `squad` Spieler dasselbe Relikt öffnen und jeder das beste
 * der gezogenen Teile nimmt (Radshare): E[max] über alle Belohnungen.
 */
export function expectedValue(rewards, valueOf, squad) {
  const sorted = rewards.map((r) => ({ v: valueOf(r), p: r.chance / 100 })).sort((a, b) => b.v - a.v);
  let better = 0;
  let ev = 0;
  for (const { v, p } of sorted) {
    ev += v * ((1 - better) ** squad - (1 - better - p) ** squad);
    better += p;
  }
  return ev;
}

export function rarityOf(chance) {
  if (chance <= 10) return 'rare';
  if (chance <= 20) return 'uncommon';
  return 'common';
}

export const wikiFor = (name) => `https://wiki.warframe.com/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;

export const removeTodo = (id) => setTodo(todo().filter((x) => x !== id));

/**
 * Mastery- und Bau-Status eines Items.
 * mastered (Max-Rang) · leveling (besitzt man/hat XP) · buildable (alles da) ·
 * blueprints (alle Blaupausen/Teile da, Rohstoffe oder Bauen fehlen) · missing
 */
export function evaluate(item, inv) {
  const xp = inv?.xp[item.id] ?? 0;
  const perRank = item.maxXp / (item.maxRank * item.maxRank);
  const rank = Math.min(item.maxRank, Math.floor(Math.sqrt(xp / perRank)));
  const owned = (inv?.owned[item.id] ?? 0) > 0;
  const parts = item.components.filter((c) => c.kind === 'part').map((c) => ({ ...c, built: builtCount(inv, c.id), bp: blueprintOnlyCount(inv, c.id) }));
  const resources = item.components.filter((c) => c.kind === 'resource').map((c) => ({ ...c, built: builtCount(inv, c.id), bp: 0 }));
  const partsComplete = parts.length > 0 && parts.every((p) => p.built + p.bp >= p.count);
  const allBuilt = parts.every((p) => p.built >= p.count);
  const resourcesOk = resources.every((r) => r.built >= r.count);
  const creditsOk = (inv?.player.credits ?? 0) >= (item.credits ?? 0);
  let status;
  if (xp >= item.maxXp) status = 'mastered';
  else if (owned || xp > 0) status = 'leveling';
  else if (partsComplete && allBuilt && resourcesOk && creditsOk) status = 'buildable';
  else if (partsComplete) status = 'blueprints';
  else status = 'missing';
  return { item, xp, rank, owned, parts, resources, status, creditsOk };
}

/** 1500 -> "1.5K", 2000000 -> "2M" */
export const compact = (n) => (n == null ? '–' : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));

/** In die Zwischenablage (Browser-API, sonst über ein unsichtbares Textfeld). */
export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Zwischenablage nicht verfügbar');
  });
}

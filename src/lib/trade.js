import { evaluate } from './evaluate.js';
import { builtCount, blueprintOnlyCount } from './GameData.jsx';

// Handel: welche Prime-Teile übrig sind (für Baro oder zum Verkaufen) und WTS-Nachrichten.

/**
 * Übrige Prime-Teile. Konservativ: Ein Teil zählt nur als übrig, wenn kein noch nicht gebautes
 * Item es braucht (gemeisterte oder schon gebaute Items brauchen nichts mehr). Gebaute Warframe-Bauteile
 * lassen sich weder handeln noch an Baro geben – übrig sind nur Blaupausen bzw. Waffenteile.
 * -> [{ id, part, items: [item…], have, need, spare, ducats }]
 */
export function spareParts(db, inv) {
  if (!db || !inv) return [];
  const byId = new Map();
  for (const item of db.items) {
    if (!item.isPrime) continue;
    const ev = evaluate(item, inv);
    const done = ev.status === 'mastered' || ev.owned;
    for (const part of item.components) {
      if (part.kind !== 'part' || !part.ducats) continue;
      let e = byId.get(part.id);
      if (!e) {
        e = { id: part.id, part, items: [], need: 0, ducats: part.ducats };
        byId.set(part.id, e);
      }
      e.items.push(item);
      if (!done) e.need += part.count;
    }
  }
  const out = [];
  for (const e of byId.values()) {
    const isComponent = e.id.endsWith('Component');
    // Bei Warframe-Bauteilen nur die Blaupause; gebaute Teile werden zuerst für den Bedarf verwendet
    const tradable = isComponent ? blueprintOnlyCount(inv, e.id) : builtCount(inv, e.id);
    const have = (isComponent ? inv.counts[e.id] ?? 0 : 0) + tradable;
    const spare = Math.max(0, Math.min(tradable, have - e.need));
    if (spare > 0) out.push({ ...e, have, spare });
  }
  return out;
}

/**
 * Komplette Sets aus übrigen Teilen (nur Items, deren Teile alle Prime-Teile sind).
 * -> [{ item, count }] – die Teile dafür werden aus `spare` (Map id -> Anzahl) abgezogen.
 */
export function spareSets(db, spare) {
  const out = [];
  for (const item of db.items) {
    if (!item.isPrime) continue;
    const parts = item.components.filter((c) => c.kind === 'part');
    if (!parts.length || parts.some((p) => !p.ducats)) continue;
    const count = Math.min(...parts.map((p) => Math.floor((spare.get(p.id) ?? 0) / p.count)));
    if (count < 1) continue;
    for (const p of parts) spare.set(p.id, spare.get(p.id) - p.count * count);
    out.push({ item, count });
  }
  return out;
}

/** Trade-Chat erlaubt nur kurze Nachrichten – sicherheitshalber darunter bleiben. */
export const CHAT_LIMIT = 180;

/** [{ name, price, qty }] -> ["WTS [A] 12p [B] x2 8p", …] (bei Bedarf mehrere Nachrichten) */
export function wtsMessages(entries, limit = CHAT_LIMIT) {
  const msgs = [];
  let cur = '';
  for (const e of entries) {
    const piece = `[${e.name}]${e.qty > 1 ? ` x${e.qty}` : ''} ${e.price}p`;
    if (cur && cur.length + 1 + piece.length > limit) {
      msgs.push(cur);
      cur = '';
    }
    cur = cur ? `${cur} ${piece}` : `WTS ${piece}`;
  }
  if (cur) msgs.push(cur);
  return msgs;
}

export function copyToClipboard(text) {
  if (window.wf?.copyText) {
    window.wf.copyText(text);
    return Promise.resolve();
  }
  return navigator.clipboard.writeText(text).catch(() => {
    // Ohne Schreibrecht auf die Zwischenablage: klassisch über ein unsichtbares Textfeld
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

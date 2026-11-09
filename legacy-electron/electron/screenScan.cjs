// Erkennt per Windows-OCR, was im Spiel gerade zu sehen ist:
//  - "selection": Relikt-Auswahl ("Meso V17 Relic [Radiant] - Possible Rewards")
//  - "rewards":   Belohnungs-Bildschirm nach der Spalten-Mission (bis zu 4 Teile, eins pro Spieler)
// Ohne Electron-Abhängigkeit, damit es auch der Vite-Dev-Server zum Testen nutzen kann.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// ---------- dauerhaft laufender OCR-Prozess ----------
let ocr = null;
function ocrProcess() {
  if (ocr && !ocr.proc.killed && ocr.proc.exitCode === null) return ocr;
  const script = path.join(__dirname, 'ocr.ps1').replace('app.asar', 'app.asar.unpacked');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
  });
  const state = { proc, buffer: '', waiting: [] };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    state.buffer += chunk;
    let i;
    while ((i = state.buffer.indexOf('\n')) >= 0) {
      const line = state.buffer.slice(0, i).trim();
      state.buffer = state.buffer.slice(i + 1);
      if (!line) continue;
      const next = state.waiting.shift();
      if (!next) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.error) next.reject(new Error(msg.error));
        else if ('fg' in msg) next.resolve(msg.fg);
        else next.resolve(Array.isArray(msg.words) ? msg.words : msg.words ? [msg.words] : []);
      } catch (e) {
        next.reject(e);
      }
    }
  });
  // stderr MUSS gelesen werden: läuft der Puffer voll (Warnungen von PowerShell),
  // bleibt der Prozess stehen und keine Anfrage wird mehr beantwortet.
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d) => {
    const text = String(d).trim();
    if (text) console.warn('[ocr]', text.slice(0, 300));
  });
  proc.on('exit', () => {
    if (ocr === state) ocr = null;
    state.waiting.splice(0).forEach((w) => w.reject(new Error('OCR-Prozess beendet')));
  });
  ocr = state;
  return state;
}

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Eine Zeile an den OCR-Prozess schicken und auf die Antwortzeile warten.
 * Antwortet er nicht rechtzeitig, wird er beendet (alle offenen Anfragen schlagen fehl)
 * und beim nächsten Aufruf neu gestartet – so kann nie etwas dauerhaft hängen bleiben.
 */
function request(line) {
  const state = ocrProcess();
  return new Promise((resolve, reject) => {
    const entry = {
      resolve: (v) => (clearTimeout(entry.timer), resolve(v)),
      reject: (e) => (clearTimeout(entry.timer), reject(e)),
    };
    entry.timer = setTimeout(() => {
      console.warn('[ocr] keine Antwort – Prozess wird neu gestartet');
      if (ocr === state) ocr = null;
      state.proc.kill();
      const i = state.waiting.indexOf(entry);
      if (i >= 0) state.waiting.splice(i, 1);
      reject(new Error('Texterkennung antwortet nicht (Neustart)'));
    }, REQUEST_TIMEOUT_MS);
    state.waiting.push(entry);
    state.proc.stdin.write(`${line}\n`);
  });
}

/** Wörter mit Positionen aus einem Bild (PNG/JPG). */
function recognize(imagePath) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Texterkennung gibt es nur unter Windows.'));
  // Windows-OCR (StorageFile) braucht einen vollen Pfad mit "\" und ohne 8.3-Kurznamen.
  let full = path.resolve(imagePath);
  try {
    full = fs.realpathSync.native(full);
  } catch {
    /* Datei fehlt – Fehler kommt vom OCR-Prozess */
  }
  return request(full);
}

/** Prozessname des Fensters im Vordergrund (z. B. "Warframe.x64"), "" wenn unbekannt. */
function foregroundProcess() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return request('FG');
}

// ---------- unscharfer Textvergleich ----------
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// ---------- Wörter zu Textblöcken gruppieren ----------
// Ein Blockname kann über 2–3 Zeilen umbrechen ("Voruna Prime / Systems / Blueprint").
function groupBlocks(words) {
  const parent = words.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      const h = Math.max(a.h, b.h, 8);
      const sameLine = Math.abs(a.y - b.y) < h * 0.6;
      const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if ((sameLine && gapX < h * 1.1) || (!sameLine && gapY < h * 0.9 && overlapX > -h * 0.5)) union(i, j);
    }
  }
  const groups = new Map();
  words.forEach((w, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  });
  return [...groups.values()].map((ws) => {
    ws.sort((a, b) => (Math.abs(a.y - b.y) < a.h * 0.6 ? a.x - b.x : a.y - b.y));
    const x = Math.min(...ws.map((w) => w.x));
    const y = Math.min(...ws.map((w) => w.y));
    const r = Math.max(...ws.map((w) => w.x + w.w));
    const btm = Math.max(...ws.map((w) => w.y + w.h));
    return { text: ws.map((w) => w.t).join(' '), x, y, w: r - x, h: btm - y };
  });
}

function bestMatch(text, names, min) {
  let best = null;
  let score = min;
  for (const n of names) {
    const s = similarity(text, n);
    if (s > score) {
      score = s;
      best = n;
    }
  }
  return best ? { name: best, score } : null;
}

// ---------- Auswertung ----------
const REF_WORDS = { intact: 'intact', exceptional: 'exceptional', flawless: 'flawless', radiant: 'radiant' };

// Hover-Tooltip über einer Belohnung: Titel in GROSSBUCHSTABEN ("ATHODAI PRIME BARREL"), darunter
// "Tradeable", Beschreibung und "Can be exchanged for … Ducats". Die Namen im Raster sind nie komplett groß.
const isCaps = (t) => {
  const letters = t.replace(/[^a-z]/gi, '');
  return letters.length >= 6 && letters === letters.toUpperCase();
};
const TOOLTIP_WORD = /^(un)?tradeable$|^exchanged$|^ducats.?$|^component.?$/i;

/** Rechteck des Tooltips (Bildschirm-Pixel) oder null. */
function findTooltip(words, rewardBlocks, rewardNames) {
  const title = rewardBlocks.find((b) => isCaps(b.text) && bestMatch(b.text, rewardNames, 0.7));
  if (!title) return null;
  const lineH = Math.min(title.h, Math.max(...words.filter((w) => w.y >= title.y - 2 && w.y <= title.y + title.h).map((w) => w.h), 8));
  const below = words.filter((w) => TOOLTIP_WORD.test(w.t) && w.y > title.y && w.y < title.y + lineH * 14 && w.x >= title.x - lineH * 2);
  const bottom = below.length ? Math.max(...below.map((w) => w.y + w.h)) + lineH * 0.6 : title.y + title.h + lineH * 6;
  // Rechte Kante: Textzeilen des Tooltips beginnen links am Titel; Nachbar-Texte rechts davon sind durch eine Lücke getrennt
  let right = title.x + title.w;
  const band = words.filter((w) => w.y >= title.y && w.y + w.h <= bottom + lineH && w.x >= title.x - lineH * 2);
  const lines = [];
  for (const w of band.sort((a, b) => a.y - b.y)) {
    const line = lines.find((l) => Math.abs(l[0].y - w.y) < lineH * 0.6);
    if (line) line.push(w);
    else lines.push([w]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    if (line[0].x > title.x + lineH * 3) continue;
    let end = line[0].x + line[0].w;
    for (const w of line.slice(1)) {
      if (w.x - end > lineH * 2.5) break;
      end = Math.max(end, w.x + w.w);
    }
    right = Math.max(right, end);
  }
  const pad = lineH * 0.6;
  // Der Kasten ist etwas breiter als sein Text
  return { x: title.x - pad, y: title.y - pad, w: right - title.x + pad * 2 + lineH * 1.5, h: bottom - title.y + pad * 2 };
}

/**
 * @param words  OCR-Wörter
 * @param relicDb  { relics: [{ id, name, rewards: { intact: [{name}], … } }] }
 */
const ERAS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem'];

/**
 * Ära der Relikt-Auswahl: aus der Überschrift oben links ("MESO ERA") – oder, falls die nicht
 * lesbar ist, die Ära, die bei den Kachelnamen ("Lith A2 Relic") am häufigsten vorkommt.
 */
function findEra(words) {
  for (let i = 0; i < words.length - 1; i++) {
    const next = words[i + 1];
    if (similarity(next.t, 'era') < 0.6 || Math.abs(next.y - words[i].y) > words[i].h * 0.6) continue;
    const era = ERAS.find((e) => similarity(words[i].t, e) >= 0.75);
    if (era) return era;
  }
  const votes = new Map();
  for (let i = 0; i < words.length - 2; i++) {
    if (similarity(words[i + 2].t, 'relic') < 0.6) continue; // auch "helic"/"Aelic"
    const era = ERAS.find((e) => similarity(words[i].t, e) >= 0.75);
    if (era) votes.set(era, (votes.get(era) ?? 0) + 1);
  }
  const [best] = [...votes].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 3 ? best[0] : null;
}

/**
 * Relikt-Kacheln im Raster der Relikt-Auswahl ("Lith A6 Relic", "Lith G14 Relic [Radiant]").
 * Liefert pro Kachel das Relikt und die Position des Namens.
 */
// Typische OCR-Verwechslungen in Relikt-Codes ("Lith 83" = B3, "GS" = G9, "MIO" = M10, "07" = D7)
const AS_LETTER = { 8: ['B'], 0: ['D', 'O'], 1: ['I'], 5: ['S'], 6: ['G'], 2: ['Z'], 4: ['A'] };
const AS_DIGIT = {
  I: ['1'], L: ['1'], '|': ['1'], '!': ['1'], J: ['1'], F: ['1'], T: ['7'],
  O: ['0'], Q: ['0'], D: ['0'], U: ['0'],
  S: ['5', '9'], G: ['6', '9'], B: ['8'], Z: ['2'], A: ['4'],
};

/** Alle plausiblen Lesarten eines Codes: Buchstabe + Ziffern. */
function codeVariants(raw) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9|!]/g, '');
  if (s.length < 2 || s.length > 4) return [];
  let out = [/[A-Z]/.test(s[0]) ? [s[0]] : AS_LETTER[s[0]] ?? []].flat();
  for (const ch of s.slice(1)) {
    const opts = /[0-9]/.test(ch) ? [ch] : AS_DIGIT[ch] ?? [];
    out = out.flatMap((p) => opts.map((o) => p + o));
    if (out.length > 64) return [];
  }
  return out;
}

/**
 * Relikt-Kacheln im Raster der Relikt-Auswahl ("Lith A6 Relic", "Lith G14 Relic [Radiant]").
 * Nur eindeutige Treffer – bei Mehrdeutigkeit lieber keine Zahl als eine falsche.
 */
/**
 * Code aus einem Kachel-Namen, so wie die OCR ihn im echten Spiel liest:
 * "Neo A1 6 Relic" (A16), "Neo Bl Aelic" (B1), "Neo A1 2ZRelic" (A12), "Neo G8" (ohne "Relic").
 */
function tileCode(text, era) {
  const tokens = text.trim().split(/\s+/);
  // Ära an den Code geklebt ("MesoV17")
  if (tokens[0].length > era.length + 1 && similarity(tokens[0].slice(0, era.length), era) >= 0.75) {
    tokens.splice(0, 1, tokens[0].slice(0, era.length), tokens[0].slice(era.length));
  }
  if (tokens.length < 2 || similarity(tokens[0], era) < 0.6) return null;
  const isRelic = (t) => t.length >= 4 && similarity(t.replace(/[^a-z]/gi, ''), 'relic') >= 0.6;
  let parts = [];
  for (const t of tokens.slice(1)) {
    // "Relic" an den Code geklebt ("2ZRelic", "A11'Relic") – vor isRelic prüfen, sonst ginge der Code verloren
    const glued = /^(.{1,3}?)['’.,]?([A-Za-z]elic|[A-Za-z]el[il1]c)$/i.exec(t);
    // Ein Buchstabe direkt vor "Relic" nach einer Ziffer ist Müll ("2ZRelic" = 2)
    if (glued) return parts.join('') + glued[1].replace(/(\d)[A-Za-z]$/, '$1');
    if (isRelic(t)) return parts.join('');
    parts.push(t);
    if (parts.join('').length > 4) return null;
  }
  // Kein "Relic" gelesen: nur "<Ära> <Code>" allein im Block gilt
  return tokens.length === 2 ? tokens[1] : null;
}

function findTiles(blocks, relics, era, rightEdge, ownedRelics, ownedOnly = false) {
  const byCode = new Map(relics.filter((r) => r.tier === era).map((r) => [r.name.split(' ').slice(1).join(' ').toUpperCase(), r]));
  const lookup = (code) => {
    const variants = codeVariants(code);
    // "L3" wird gern als "I3" gelesen (und umgekehrt)
    for (const v of [...variants]) if (/^[IL]/.test(v)) variants.push((v[0] === 'I' ? 'L' : 'I') + v.slice(1));
    const hits = [...new Set(variants)].map((c) => byCode.get(c)).filter(Boolean);
    if (!ownedRelics) return hits;
    // Eigene Relikte haben Vorrang – das löst "GS" = G5 oder G9 und "I3" = L3 auf.
    // Nach "Refinement"/"Owned" sortiert zeigt das Spiel nur eigene, nach "Name" auch fremde.
    const owned = hits.filter((r) => ownedRelics.has(r.id));
    return owned.length || ownedOnly ? owned : hits;
  };
  const tiles = [];
  for (const b of blocks) {
    if (b.x > rightEdge) continue; // rechts ist das "Possible Rewards"-Feld
    const code = tileCode(b.text, era);
    if (!code) continue;
    // Kein Abschneiden von Zeichen: aus "C1 f" (C11) würde sonst das falsche Relikt C1
    const hits = lookup(code);
    if (hits.length !== 1) continue;
    tiles.push({ relicId: hits[0].id, name: hits[0].name, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  return tiles;
}

/**
 * Sortierung und Suchtext über dem Raster ("REFINEMENT ▼  SEARCH..."), unter "COLLECTED 67/195".
 * Ändert sich eins davon, zeigt das Raster andere Relikte an anderen Stellen.
 */
const SORTS = ['name', 'refinement', 'owned'];
function gridView(words) {
  const col = words.find((w) => similarity(w.t, 'collected') >= 0.7);
  if (!col) return { sort: null, search: null };
  const line = words.filter((w) => w.y > col.y + col.h * 0.5 && w.y < col.y + col.h * 4 && Math.abs(w.x - col.x) < col.w * 4);
  const sortWord = line.find((w) => SORTS.some((s) => similarity(w.t, s) >= 0.8));
  const sort = sortWord ? SORTS.find((s) => similarity(sortWord.t, s) >= 0.8) : null;
  const rest = line.filter((w) => w !== sortWord && (!sortWord || w.x > sortWord.x + sortWord.w) && /[a-z0-9]/i.test(w.t));
  const search = rest.some((w) => similarity(w.t.replace(/[^a-z]/gi, ''), 'search') >= 0.7) ? '' : rest.map((w) => w.t.toLowerCase()).join(' ') || null;
  return { sort, search };
}

/**
 * @param words  OCR-Wörter
 * @param relicDb  { relics: [{ id, name, rewards: { intact: [{name}], … } }] }
 * @param ownedRelics  optional: Set eigener Relikt-IDs (löst mehrdeutige Kachel-Namen auf)
 */
function analyze(words, relicDb, ownedRelics = null) {
  const relics = relicDb.relics;
  const rewardNames = [...new Set(relics.flatMap((r) => (r.rewards.intact ?? []).map((w) => w.name)))];
  const blocks = groupBlocks(words);
  const era = findEra(words);
  const possibleWord = words.find((w) => /^possible$/i.test(w.t));
  // Raster endet links vom Titel "<Relikt> - Possible Rewards"
  const titleLeft = possibleWord
    ? Math.min(...words.filter((w) => Math.abs(w.y - possibleWord.y) < possibleWord.h * 0.6).map((w) => w.x))
    : Infinity;
  const view = gridView(words);
  const ownedOnly = view.sort === 'refinement' || view.sort === 'owned';
  const tiles = era ? findTiles(blocks, relics, era, titleLeft - 10, ownedRelics, ownedOnly) : [];

  // 1) Relikt-Auswahl: Zeile "<Name> Relic [<Stufe>] - Possible Rewards"
  const possible = possibleWord;
  if (possible) {
    const line = words
      .filter((w) => Math.abs(w.y - possible.y) < possible.h * 0.6 && w.x < possible.x)
      .sort((a, b) => a.x - b.x)
      .map((w) => w.t);
    const relicWord = line.findIndex((t) => /^relic/i.test(t));
    const nameGuess = (relicWord > 0 ? line.slice(0, relicWord) : line).join(' ');
    const refWord = line.map((t) => norm(t)).find((t) => REF_WORDS[t]);
    const refinement = REF_WORDS[refWord] ?? 'intact';

    // Belohnungs-Blöcke unter dem Titel (rechts im Bild)
    const belowTitle = blocks.filter((b) => b.y > possible.y + possible.h && b.x > possible.x - possible.w * 6);
    const tooltip = findTooltip(words, belowTitle, rewardNames);
    // Tooltip-Titel ist kein Name im Raster
    const rewardBlocks = belowTitle.filter((b) => !isCaps(b.text));
    const spots = rewardBlocks
      .map((b) => ({ ...b, match: bestMatch(b.text, rewardNames, 0.7) }))
      .filter((b) => b.match)
      .map((b) => ({ name: b.match.name, x: b.x, y: b.y, w: b.w, h: b.h }));
    const shown = spots.map((s) => s.name);

    // Bester Kandidat: Name ähnlich + möglichst viele passende Belohnungen
    let best = null;
    for (const r of relics) {
      const nameScore = similarity(nameGuess, r.name);
      if (nameScore < 0.5) continue;
      const names = new Set((r.rewards[refinement] ?? r.rewards.intact ?? []).map((w) => w.name));
      const hits = shown.filter((n) => names.has(n)).length;
      const score = nameScore + hits * 0.5;
      if (!best || score > best.score) best = { relic: r, score, nameScore, hits };
    }
    if (best) {
      // Positionen nur gegen die 6 Belohnungen dieses Relikts abgleichen, jeden Namen nur einmal
      // vergeben (sonst wird "Boar Prime Barrel" leicht zu "Soma Prime Barrel" und ein Schild fehlt)
      const own = (best.relic.rewards[refinement] ?? best.relic.rewards.intact ?? []).map((w) => w.name);
      const pairs = rewardBlocks
        .flatMap((b) => own.map((name) => ({ b, name, score: similarity(b.text, name) })))
        .filter((p) => p.score >= 0.6)
        .sort((a, b) => b.score - a.score);
      const usedBlocks = new Set();
      const usedNames = new Set();
      const ownSpots = [];
      for (const p of pairs) {
        if (usedBlocks.has(p.b) || usedNames.has(p.name)) continue;
        usedBlocks.add(p.b);
        usedNames.add(p.name);
        ownSpots.push({ name: p.name, x: p.b.x, y: p.b.y, w: p.b.w, h: p.b.h });
      }
      return {
        mode: 'selection',
        era: era ?? best.relic.tier,
        relicId: best.relic.id,
        relicName: best.relic.name,
        refinement,
        // Wie sicher? (Overlay wechselt das angezeigte Relikt nur bei eindeutiger Erkennung)
        nameScore: best.nameScore,
        rewardHits: best.hits,
        anchor: { x: possible.x, y: possible.y, h: possible.h },
        titleLeft, // linker Rand von "<Relikt> Relic … - Possible Rewards" (für das 3×2-Raster der Belohnungen)
        // Positionen der 6 Belohnungsnamen im Spiel – dort zeigt das Overlay kleine Info-Schilder
        spots: ownSpots,
        // Hover-Tooltip des Spiels: dort keine Schilder zeigen (verdeckte Belohnungen)
        tooltip,
        tiles,
        view,
      };
    }
  }

  // Relikt-Auswahl ohne angeklicktes Relikt: nur die Ära (+ Kacheln im Raster)
  // "Select a Relic to view its rewards." -> rechts ist nichts angeklickt
  const noRelic = words.some((w, i) => /^select$/i.test(w.t) && similarity(words[i + 2]?.t ?? '', 'relic') >= 0.6);
  if (era) return { mode: 'selection', era, relicId: null, tiles, noRelic, view };

  // 2) Belohnungs-Bildschirm: Blöcke, die nach Prime-Teilen klingen, nebeneinander
  const items = [];
  for (const b of blocks) {
    const m = bestMatch(b.text, rewardNames, 0.72);
    if (m) items.push({ name: m.name, score: m.score, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  if (!items.length) return { mode: 'none' };
  // Nur die Reihe mit den meisten Treffern (die Belohnungen stehen auf einer Höhe)
  const rows = new Map();
  for (const it of items) {
    const key = [...rows.keys()].find((y) => Math.abs(y - it.y) < it.h * 1.5) ?? it.y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }
  const row = [...rows.values()].sort((a, b) => b.length - a.length)[0].sort((a, b) => a.x - b.x).slice(0, 4);
  return { mode: 'rewards', items: row };
}

module.exports = { recognize, analyze, groupBlocks, similarity, foregroundProcess, warmUp: ocrProcess };

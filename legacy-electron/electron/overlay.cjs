// Ingame-Overlay: Bildschirm aufnehmen, per OCR auswerten und Infos über dem Spiel anzeigen.
// Auslöser: Taste "Pos1" (Home) oder automatisch, wenn das EE.log den Belohnungs-Bildschirm meldet.
// Hinweis: Overlays sind nur im Fenster- oder randlosen Modus sichtbar, nicht im exklusiven Vollbild.
const { BrowserWindow, desktopCapturer, screen, globalShortcut, ipcMain, dialog, app, nativeImage, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { recognize, analyze, foregroundProcess, warmUp } = require('./screenScan.cjs');
const { watchLog } = require('./logWatcher.cjs');
const { getRelicDb } = require('./relicDb.cjs');
const { loadLastInventory } = require('./game.cjs');
const { recordRewards } = require('./rewardLog.cjs');
const settings = require('./settings.cjs');

const SCAN_DIR = path.join(os.tmpdir(), 'tennodeck-scans');
const SCAN_TIMEOUT_MS = 10_000;

// Bildschirm-Ausschnitte (Anteile von Breite/Höhe), passend auch für Ultrawide:
const FULL = [{ x: 0, y: 0, w: 1, h: 1 }];
// Relikt-Auswahl: oben links "MESO ERA", links das Relikt-Raster,
// rechts "<Relikt> - Possible Rewards" + Belohnungen
const SELECTION = [
  // "MESO ERA" links, Sortierung ("REFINEMENT") und Suche rechts darüber
  { x: 0, y: 0.04, w: 0.71, h: 0.135 },
  { x: 0, y: 0.17, w: 0.71, h: 0.8 },
  // Belohnungsnamen liegen über Item-Bildern – doppelt so groß erkennt die OCR sie zuverlässiger.
  // Erst unterhalb unserer Empfehlungsliste (das Overlay ist in der Aufnahme leider sichtbar).
  { x: 0.71, y: 0.16, w: 0.29, h: 0.7, zoom: 2 },
];
// Scrollleiste des Rasters: schmale Spalte rechts davon, heller Schieber auf dunkler Schiene
const SCROLLBAR = { x: 0.7007, y: 0.18, h: 0.74 };

/** Position des Schiebers (Anteil der Schienenhöhe, gerundet) – oder 'none' ohne Scrollleiste. */
function scrollPosition(shot) {
  const x = Math.round(shot.width * SCROLLBAR.x) - 2;
  const y0 = Math.round(shot.height * SCROLLBAR.y);
  const h = Math.round(shot.height * SCROLLBAR.h);
  const bmp = shot.image.crop({ x, y: y0, width: 5, height: h }).toBitmap();
  const w = bmp.length / 4 / h; // Breite nach dem Zuschneiden (bei Skalierung evtl. anders)
  let best = { start: -1, len: 0 };
  let run = { start: -1, len: 0 };
  for (let y = 0; y < h; y++) {
    let bright = 0;
    for (let i = 0; i < w; i++) {
      const p = (y * w + i) * 4;
      if ((bmp[p] + bmp[p + 1] + bmp[p + 2]) / 3 >= 90) bright++;
    }
    if (bright >= 2) {
      if (run.len === 0) run.start = y;
      run.len++;
      if (run.len > best.len) best = { ...run };
    } else run.len = 0;
  }
  // Waagerechte Linien (Kachelränder) sind nur 1–2 Pixel hoch, der Schieber deutlich mehr
  if (best.len < h * 0.03) return 'none';
  // Pixelgenau (auf 2 px gerundet): Das Raster scrollt stufenlos, 1 % der Schiene wäre schon
  // eine halbe Kachelreihe.
  return String(Math.round(best.start / 2));
}
// Das Relikt-Raster wird abwechselnd unterschiedlich aufbereitet: Jede Variante verliest andere
// Namen (im Spiel getestet: einzeln 27–29 von 31 Kacheln, zusammen alle 31).
const GRID_PASSES = [{}, { mask: true }, { zoom: 0.75 }];
const selectionRegions = (pass) => SELECTION.map((r, i) => (i === 1 ? { ...r, ...GRID_PASSES[pass % GRID_PASSES.length] } : r));

/** Nur helle, graue Pixel (Schrift) behalten: schwarz auf weiß – blendet Relikt-Bilder und Hintergrund aus. */
function textMask(img) {
  const { width, height } = img.getSize();
  const buf = Buffer.from(img.toBitmap());
  for (let i = 0; i < buf.length; i += 4) {
    const mx = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    const mn = Math.min(buf[i], buf[i + 1], buf[i + 2]);
    const v = mx >= 120 && mx - mn <= 50 ? 0 : 255;
    buf[i] = buf[i + 1] = buf[i + 2] = v;
    buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width, height });
}
const SHOW_MS = { rewards: 30_000, selection: 15_000 };

function setupOverlay({ load, preload, mainWindow, dataDir }) {
  let overlay = null;
  let hideTimer = null;
  let last = null;
  let scanning = false;

  function createOverlay() {
    const { bounds } = screen.getPrimaryDisplay();
    overlay = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setIgnoreMouseEvents(true);
    // Von Bildschirmaufnahmen ausschließen: unsere eigenen Scans sehen nur das Spiel,
    // das Overlay muss dafür nicht ausgeblendet werden (kein Flackern).
    overlay.setContentProtection(true);
    overlay.on('closed', () => (overlay = null));
    load(overlay, 'overlay');
  }

  function hide() {
    clearTimeout(hideTimer);
    overlay?.hide();
  }

  function send(channel, data) {
    for (const w of [overlay, mainWindow()]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  }

  // Belohnungs-Log: jeder echte Belohnungs-Scan (keine Test-Screenshots) landet in reward-log.json.
  // Relikt = zuletzt in der Auswahl angeklicktes (falls die Auswahl vor höchstens 30 Min. offen war).
  const RELIC_KEEP_MS = 30 * 60 * 1000;
  function logRewards(result) {
    if (result.mode !== 'rewards' || result.reason === 'file') return;
    const sel = watch.current;
    const relic =
      sel?.relicId && Date.now() - watch.lastSeen < RELIC_KEEP_MS
        ? { id: sel.relicId, name: sel.relicName ?? null, refinement: sel.refinement ?? null }
        : null;
    recordRewards(dataDir(), result, relic)
      .then((entry) => entry && send('rewardLog:changed', entry))
      .catch((e) => console.warn(`[overlay] Belohnungs-Log: ${e.message}`));
  }

  function publish(result) {
    last = result;
    logRewards(result);
    send('scan:result', result);
    if (result.mode === 'rewards' || result.mode === 'selection') {
      if (!overlay) createOverlay();
      overlay.showInactive();
      clearTimeout(hideTimer);
      // Während die Relikt-Auswahl beobachtet wird, bleibt das Overlay stehen.
      if (!(result.mode === 'selection' && watch.active)) hideTimer = setTimeout(hide, SHOW_MS[result.mode]);
    }
  }

  // ---------- Relikt-Auswahl automatisch beobachten ----------
  // Geöffnet laut EE.log -> alle 1,5 s scannen (nur wenn das Spiel im Vordergrund ist),
  // Ära/Relikt aktualisieren, bis ein anderer Bildschirm kommt.
  const WATCH_MS = 500; // Pause zwischen zwei Scans (ein Scan dauert ~0,3 s)
  const TILE_KEEP_MS = 60_000; // Notbremse: so lange bleibt eine Kachel-Zahl ohne erneute Erkennung stehen
  const WATCH_MAX_MS = 15 * 60 * 1000;
  const watch = {
    active: false,
    focused: true,
    timer: null,
    since: 0,
    signature: '',
    lastSeen: 0,
    pendingStop: false,
    pass: 0, // welche Aufbereitung des Rasters als Nächstes dran ist (GRID_PASSES)
    tileCache: new Map(), // Ansicht des Rasters (Ära|Sortierung|Suche|Scroll) -> Kacheln
    current: null, // zuletzt angezeigter Stand (Ära + angeklicktes Relikt)
  };

  // Eigene Relikte (aus dem letzten Sync) – lösen mehrdeutige Kachel-Namen auf ("GS" = G5 oder G9)
  let ownedRelics = null;
  async function loadOwnedRelics() {
    const inv = await loadLastInventory(dataDir()).catch(() => null);
    ownedRelics = inv?.relics ? new Set(Object.keys(inv.relics)) : null;
  }
  loadOwnedRelics();

  function startWatch() {
    loadOwnedRelics();
    watch.active = true;
    watch.since = Date.now();
    watch.signature = '';
    watch.lastSeen = Date.now();
    watch.pendingStop = false;
    watch.tileCache.clear();
    // Sofort die Empfehlungen zeigen (die Auswahl ist laut Log offen) – Ära kommt mit dem ersten Scan.
    // Die zuletzt gesehene Ära ist eine gute erste Schätzung (das Spiel merkt sie sich auch).
    const lastEra = watch.current?.era ?? last?.era ?? null;
    watch.current = { mode: 'selection', era: lastEra, relicId: null, tiles: [], spots: [], reason: 'open', at: Date.now() };
    watch.signature = signature(watch.current);
    publish(watch.current);
    clearTimeout(watch.timer);
    // Kurz warten, bis die Auswahl fertig aufgebaut ist
    watch.timer = setTimeout(watchTick, 400);
  }

  /**
   * Neuen Scan mit dem bisherigen Stand zusammenführen: Das angeklickte Relikt wechselt nur,
   * wenn rechts eindeutig ein anderes erkannt wird (Name + passende Belohnungen). Scans ohne
   * Relikt – etwa weil ein Tooltip darüberliegt – behalten das bisherige.
   */
  function mergeSelection(prev, r) {
    const now = Date.now();
    prev ??= {};
    const era = r.era ?? prev.era;
    // Welcher Ausschnitt des Rasters ist zu sehen? Ära + Sortierung + Suche + Scroll-Position.
    // Für jeden merken wir uns die Kacheln – beim Zurückscrollen sind die Zahlen sofort wieder da.
    const view = { sort: r.view?.sort ?? prev.view?.sort ?? null, search: r.view?.search ?? prev.view?.search ?? null };
    const scroll = r.scroll ?? prev.scroll ?? null;
    const gridKey = `${era}|${view.sort}|${view.search}|${scroll}`;
    if (prev.gridKey && gridKey !== prev.gridKey) watch.tileCache.set(prev.gridKey, prev.tiles ?? []);
    const base = gridKey === prev.gridKey ? prev.tiles ?? [] : watch.tileCache.get(gridKey) ?? [];
    const tiles = mergeTiles(base, r.tiles ?? [], now);
    watch.tileCache.set(gridKey, tiles);
    r = { ...r, view, scroll, gridKey };
    const sure = r.relicId && (r.rewardHits >= 2 || r.nameScore >= 0.9);
    if (sure && r.relicId === prev.relicId && r.refinement === prev.refinement) {
      // Gleiches Relikt: bisher gefundene Belohnungs-Positionen behalten und ergänzen
      const spots = [...(r.spots ?? [])];
      for (const s of prev.spots ?? []) if (!spots.some((x) => x.name === s.name)) spots.push(s);
      return { ...r, era, tiles, spots };
    }
    if (sure) return { ...r, era, tiles };
    // Ära gewechselt (Q/E) ohne neues Relikt -> altes Relikt gehört nicht mehr dazu;
    // ebenso, wenn rechts "Select a Relic …" steht
    if (era !== prev.era || r.noRelic) return { ...r, era, relicId: null, spots: [], tiles };
    return {
      ...r,
      era,
      tiles,
      relicId: prev.relicId,
      relicName: prev.relicName,
      refinement: prev.refinement,
      spots: prev.spots,
      anchor: prev.anchor,
      titleLeft: prev.titleLeft,
    };
  }

  /**
   * Kacheln "klebrig" machen: Im echten Spiel liest die OCR pro Scan nur einen Teil der Namen
   * (Text über dem Relikt-Bild). Eine Zahl bleibt deshalb stehen, bis an ihrer Stelle ein
   * anderes Relikt öfter erkannt wird als das bisherige (Abstimmung pro Kachel).
   * Ändert sich mindestens die Hälfte der gelesenen Kacheln auf einmal, wurde gescrollt –
   * dann werden alle alten Zahlen verworfen, damit keine an der falschen Kachel hängt.
   */
  function mergeTiles(prevTiles, newTiles, now) {
    const center = (t) => ({ x: t.x + t.w / 2, y: t.y + t.h });
    const near = (a, b) => {
      const p = center(a);
      const q = center(b);
      return Math.abs(p.x - q.x) < Math.max(a.w, b.w) * 0.6 && Math.abs(p.y - q.y) < Math.max(a.h, b.h) * 1.5;
    };
    const fresh = (t) => ({ ...t, seen: now, votes: { [t.relicId]: 1 } });
    const out = [];
    const used = new Set();
    let matched = 0;
    let changed = 0;
    for (const t of newTiles) {
      const old = prevTiles.find((o) => near(t, o));
      if (!old) {
        out.push(fresh(t));
        continue;
      }
      used.add(old);
      matched++;
      if (old.relicId !== t.relicId) changed++;
      // Abstimmung pro Kachel: ein einzelner Verleser überstimmt nicht das, was vorher oft gelesen wurde
      const votes = {};
      for (const [id, n] of Object.entries(old.votes ?? { [old.relicId]: 1 })) if (id !== t.relicId && n > 0.5) votes[id] = n - 0.5;
      votes[t.relicId] = Math.min(4, (old.votes?.[t.relicId] ?? 0) + 1);
      const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      out.push({ ...(winner === t.relicId ? t : old), seen: now, votes });
    }
    // Beim Scrollen ändern sich (fast) alle gelesenen Kacheln, bei Verlesern nur einzelne
    if (changed >= 3 && changed >= matched * 0.5) return newTiles.map(fresh);
    for (const old of prevTiles) {
      if (!used.has(old) && now - old.seen <= TILE_KEEP_MS) out.push(old);
    }
    // Alle Namen einer Reihe enden auf derselben Höhe. Zahlen, die zu keiner gerade gelesenen
    // Reihe passen, stammen von einer anderen Scroll-Position -> weg damit.
    if (newTiles.length >= 3) {
      const rows = newTiles.map((t) => t.y + t.h);
      return out.filter((t) => rows.some((y) => Math.abs(t.y + t.h - y) < t.h * 0.6));
    }
    return out;
  }

  /** Kurzer Fingerabdruck – nur bei Änderungen wird das Overlay neu gezeichnet. */
  function signature(s) {
    const tiles = (s.tiles ?? [])
      .map((t) => `${t.relicId}@${Math.round(t.x / 20)},${Math.round(t.y / 20)}`)
      .sort()
      .join(';');
    const tip = s.tooltip ? `${Math.round(s.tooltip.x / 40)},${Math.round(s.tooltip.y / 40)}` : '-';
    return `${s.era}|${s.relicId}|${s.refinement}|${(s.spots ?? []).length}|${tip}|${tiles}`;
  }

  function stopWatch() {
    if (!watch.active) return;
    watch.active = false;
    clearTimeout(watch.timer);
    if (last?.mode === 'selection') hide();
  }

  async function watchTick() {
    if (!watch.active) return;
    if (Date.now() - watch.since > WATCH_MAX_MS) return stopWatch();
    // Nach Alt-Tab zurück im Spiel, aber die Log-Zeile kam nicht an? Selbst nachsehen.
    if (!watch.focused) {
      const fg = await foregroundProcess().catch(() => '');
      if (/^warframe/i.test(fg)) watch.focused = true;
    }
    if (watch.focused && !scanning) {
      const r = await scan('watch', { silent: true, regions: selectionRegions(watch.pass++) });
      // Auswahl nicht zu erkennen (Tooltip, Ära-Überschrift unleserlich …): nichts ändern.
      // Beenden nur, wenn das Spiel-Log einen anderen Bildschirm gemeldet hat.
      if (r?.mode !== 'selection') {
        if (watch.pendingStop) return stopWatch();
      } else {
        watch.lastSeen = Date.now();
        watch.pendingStop = false;
        const next = mergeSelection(watch.current, r);
        const sig = signature(next);
        watch.current = next;
        if (sig !== watch.signature) {
          watch.signature = sig;
          publish(next);
        } else if (!overlay?.isVisible()) {
          overlay?.showInactive();
        }
      }
    }
    if (watch.active) watch.timer = setTimeout(watchTick, WATCH_MS);
  }

  async function captureScreen() {
    const display = screen.getPrimaryDisplay();
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src) throw new Error('Kein Bildschirm zum Aufnehmen gefunden.');
    return { image: src.thumbnail, width, height, scale: display.scaleFactor };
  }

  /**
   * Nur die angegebenen Bildschirm-Ausschnitte (Anteile 0..1) erkennen und die Wortpositionen
   * auf den ganzen Bildschirm zurückrechnen. JPG statt PNG: bei 3440×1440 ~25 ms statt ~1,3 s.
   * Jeder Ausschnitt bekommt eine eigene Datei – die Windows-OCR hält die vorige kurz offen.
   */
  // Flächen, auf denen das Overlay gerade etwas zeigt (vom Overlay-Fenster gemeldet, Bildschirm-Pixel).
  // Die Aufnahme enthält das Overlay trotz setContentProtection – ohne Schwärzen liest die OCR
  // unsere eigenen Schilder mit, die Belohnungsnamen werden unlesbar und die Schilder springen.
  let overlayRects = [];
  ipcMain.on('overlay:rects', (_e, rects) => {
    if (Array.isArray(rects)) overlayRects = rects.slice(0, 200);
  });

  function blankOverlay(img, rect) {
    if (!overlay?.isVisible()) return img;
    const hits = overlayRects.filter((b) => b.x < rect.x + rect.width && b.x + b.w > rect.x && b.y < rect.y + rect.height && b.y + b.h > rect.y);
    if (!hits.length) return img;
    const { width, height } = img.getSize();
    const buf = Buffer.from(img.toBitmap());
    for (const b of hits) {
      const x0 = Math.max(0, b.x - rect.x);
      const x1 = Math.min(width, b.x + b.w - rect.x);
      const y0 = Math.max(0, b.y - rect.y);
      const y1 = Math.min(height, b.y + b.h - rect.y);
      for (let y = y0; y < y1; y++) buf.fill(0, (y * width + x0) * 4, (y * width + x1) * 4);
    }
    // Alpha wieder setzen (fill hat es auf 0 gesetzt)
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    return nativeImage.createFromBitmap(buf, { width, height });
  }

  async function recognizeRegions(shot, regions) {
    await fs.mkdir(SCAN_DIR, { recursive: true });
    const words = [];
    const files = [];
    for (const [i, r] of regions.entries()) {
      const rect = {
        x: Math.round(shot.width * r.x),
        y: Math.round(shot.height * r.y),
        width: Math.round(shot.width * r.w),
        height: Math.round(shot.height * r.h),
      };
      const file = path.join(SCAN_DIR, `scan-${Date.now()}-${i}.jpg`);
      files.push(file);
      const z = r.zoom ?? 1;
      let img = blankOverlay(shot.image.crop(rect), rect);
      if (z !== 1) img = img.resize({ width: Math.round(rect.width * z), quality: 'best' });
      if (r.mask) img = textMask(img);
      await fs.writeFile(file, img.toJPEG(92));
      for (const w of await recognize(file)) {
        words.push({ ...w, x: w.x / z + rect.x, y: w.y / z + rect.y, w: w.w / z, h: w.h / z });
      }
    }
    cleanupScans(files);
    return words;
  }

  /** Alte Scan-Bilder löschen (die gerade benutzten bleiben; gesperrte werden übersprungen). */
  async function cleanupScans(keep) {
    const files = await fs.readdir(SCAN_DIR).catch(() => []);
    for (const f of files) {
      const full = path.join(SCAN_DIR, f);
      if (!keep.includes(full) && /^scan-[\d-]+\.(png|jpg)$/.test(f)) await fs.unlink(full).catch(() => {});
    }
  }

  async function scanImage(file, screenInfo, reason) {
    const [words, relicDb] = await Promise.all([recognize(file), getRelicDb(dataDir())]);
    return { ...analyze(words, relicDb), screen: screenInfo, reason, at: Date.now() };
  }

  async function runScan(reason, regions) {
    // Das Overlay ist per setContentProtection von der Aufnahme ausgeschlossen.
    const shot = await captureScreen();
    const [words, relicDb] = await Promise.all([recognizeRegions(shot, regions), getRelicDb(dataDir())]);
    let scroll = null;
    try {
      if (regions.length === SELECTION.length) scroll = scrollPosition(shot);
    } catch (e) {
      console.warn(`[overlay] Scrollleiste nicht lesbar: ${e.message}`);
    }
    return {
      ...analyze(words, relicDb, ownedRelics),
      scroll,
      screen: { width: shot.width, height: shot.height, scale: shot.scale },
      reason,
      at: Date.now(),
    };
  }

  async function scan(reason = 'hotkey', { silent = false, regions = FULL } = {}) {
    if (scanning) return last;
    scanning = true;
    try {
      // Aufpasser: ein Scan darf nie dauerhaft blockieren (sonst gehen weder Auto-Erkennung noch Pos1)
      const result = await Promise.race([
        runScan(reason, regions),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scan hat zu lange gedauert')), SCAN_TIMEOUT_MS)),
      ]);
      if (!silent) publish(result);
      return result;
    } catch (e) {
      console.warn(`[overlay] Scan (${reason}) fehlgeschlagen: ${e.message}`);
      const result = { mode: 'error', error: e.message, reason, at: Date.now() };
      send('scan:result', result);
      return result;
    } finally {
      scanning = false;
    }
  }

  // Belohnungs-Bildschirm braucht einen Moment, bis alle Namen da sind – wie WFinfo mehrmals versuchen.
  async function autoRewards() {
    await new Promise((r) => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) {
      const r = await scan('auto');
      if (r?.mode === 'rewards') return;
      await new Promise((res) => setTimeout(res, 700));
    }
  }

  const log = watchLog();
  log.on('rewards', () => {
    stopWatch();
    if (settings.get().rewardsOverlay) autoRewards();
  });
  log.on('closed', hide);
  log.on('selectionOpen', () => settings.get().selectionOverlay && startWatch());
  // Anderer Bildschirm laut Log – beim nächsten Scan prüfen, ob die Auswahl wirklich weg ist.
  log.on('screen', () => {
    if (watch.active) watch.pendingStop = true;
  });
  log.on('focus', async (focused) => {
    if (focused) {
      watch.focused = true;
      if (watch.active && last?.mode === 'selection') overlay?.showInactive();
      return;
    }
    // "WM_ACTIVATEAPP 0" kommt auch, wenn kurz ein Hilfsfenster aufblitzt. Nur bei echtem
    // Alt-Tab (anderes Programm im Vordergrund) ausblenden.
    await new Promise((r) => setTimeout(r, 400));
    const fg = await foregroundProcess().catch(() => '');
    console.log(`[overlay] Spiel meldet Fokus-Verlust, Vordergrund: ${fg || 'unbekannt'}`);
    if (!fg || /^warframe/i.test(fg) || /^electron$/i.test(fg)) return;
    watch.focused = false;
    overlay?.hide();
  });

  // OCR-Prozess gleich starten – nicht erst mitten in der Relikt-Auswahl.
  warmUp();

  // Scan-Taste aus den Einstellungen (Standard: Pos1); bei Änderung neu belegen
  let hotkey = null;
  function registerHotkey(key) {
    if (hotkey) globalShortcut.unregister(hotkey);
    hotkey = globalShortcut.register(key, () => scan('hotkey')) ? key : null;
    if (!hotkey) console.warn(`[overlay] Taste ${key} ist schon belegt`);
  }
  registerHotkey(settings.get().hotkey);
  settings.onChange((now, prev) => {
    if (now.hotkey !== prev.hotkey) registerHotkey(now.hotkey);
    if (!now.selectionOverlay && prev.selectionOverlay) stopWatch();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    log.stop?.();
  });

  ipcMain.handle('scan:now', async () => {
    // Kurz warten, damit der Nutzer zum Spiel wechseln kann, wenn er im App-Fenster klickt.
    return scan('button');
  });
  ipcMain.handle('scan:last', () => last);
  ipcMain.handle('scan:file', async (e) => {
    const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Screenshot zum Testen auswählen',
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const { width, height } = screen.getPrimaryDisplay().size;
    const result = await scanImage(pick.filePaths[0], { width, height, scale: 1 }, 'file');
    last = result;
    send('scan:result', result);
    return result;
  });
  ipcMain.on('overlay:hide', hide);
  // Belohnungs-Infos in die Zwischenablage (Einstellung "copyRewards"; Text baut das Overlay)
  ipcMain.on('clipboard:write', (_e, text) => {
    if (typeof text === 'string' && text.length < 5000 && settings.get().copyRewards) clipboard.writeText(text);
  });

  return {};
}

module.exports = { setupOverlay, scrollPosition };

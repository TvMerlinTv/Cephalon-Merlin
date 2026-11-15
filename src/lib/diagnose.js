// Diagnose: Rohdaten aus dem Rust-Teil -> Zeilen mit Ampel und Text (reine Funktionen, getestet in core.test.js).

const MIN = 60 * 1000;
const age = (ms) => {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 60 / 24)} d`;
};

/**
 * d = Antwort von `diagnostics`; ctx = { syncedAt, syncError, worldAt, worldOffline, now }
 * -> [{ id, label, state: 'ok'|'warn'|'bad', text, vars }]  (label/text sind deutsche Übersetzungs-Schlüssel)
 */
export function diagnose(d, ctx) {
  const rows = [];
  const add = (id, label, state, text, vars) => rows.push({ id, label, state, text, vars });

  add('game', 'Warframe', d.game ? 'ok' : 'warn', d.game ? 'Das Spiel läuft.' : 'Das Spiel läuft nicht – Sync und Overlay brauchen es.');

  if (!d.log) add('log', 'EE.log', 'warn', 'Nicht gefunden – Warframe wurde auf diesem PC noch nicht gestartet.');
  else {
    const old = d.log.modified != null ? ctx.now - d.log.modified : null;
    add('log', 'EE.log', 'ok', old != null ? 'Gefunden, zuletzt geändert vor {t}.' : 'Gefunden.', { t: old != null ? age(old) : '' });
  }

  if (ctx.syncError) add('sync', 'Spiel-Sync', 'bad', 'Der letzte Sync ist fehlgeschlagen.');
  else if (!ctx.syncedAt) add('sync', 'Spiel-Sync', 'warn', 'Noch nie synchronisiert.');
  else {
    const old = ctx.now - ctx.syncedAt;
    add('sync', 'Spiel-Sync', old > 7 * 24 * 60 * MIN ? 'warn' : 'ok', 'Letzter Sync vor {t}.', { t: age(old) });
  }

  const online = d.net?.online !== false;
  add('net', 'Internet', online ? 'ok' : 'bad', online ? 'Verbunden.' : 'Keine Verbindung.');

  if (d.market?.ok) add('market', 'warframe.market', d.market.ms > 4000 ? 'warn' : 'ok', 'Erreichbar ({ms} ms).', { ms: d.market.ms });
  else add('market', 'warframe.market', 'bad', 'Nicht erreichbar: {e}', { e: d.market?.error ?? '?' });

  if (ctx.worldOffline) add('world', 'Weltstatus', 'warn', 'Offline – zeigt den letzten Stand.');
  else if (!ctx.worldAt) add('world', 'Weltstatus', 'warn', 'Noch nicht geladen.');
  else add('world', 'Weltstatus', 'ok', 'Aktuell (vor {t}).', { t: age(ctx.now - new Date(ctx.worldAt).getTime()) });

  add('data', 'Datenordner', d.writable ? 'ok' : 'bad', d.writable ? 'Beschreibbar.' : 'Nicht beschreibbar – Einstellungen können nicht gespeichert werden.');
  add('relics', 'Relikt-Datenbank', d.relicDb ? 'ok' : 'warn', d.relicDb ? 'Vorhanden.' : 'Noch nicht geladen – wird beim ersten Öffnen einer Relikt-Seite geholt.');
  return rows;
}

const MARK = { ok: 'OK ', warn: 'WARN', bad: 'FEHLER' };

/** Bericht als Text (deutsch, ohne persönliche Daten). */
export function reportText(d, rows) {
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
  return [
    `Cephalon Merlin ${d.version} · WebView2 ${d.webview}`,
    ...rows.map((r) => `[${MARK[r.state]}] ${r.label}: ${fill(r.text, r.vars)}`),
    `Overlay-Fenster: ${d.overlay ? 'angelegt' : 'noch nicht benutzt'}`,
  ].join('\n');
}

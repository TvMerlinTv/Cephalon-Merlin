import { useEffect, useRef } from 'react';
import { load, save } from './api.js';
import { useSettings } from './settings.js';
import { translate } from './i18n.js';
import { useBaroDucatNotification } from './baroDucats.js';

// Windows-Benachrichtigungen (über die Notification-API von Electron) für Zyklus-Wechsel und Baro.

const PLACES = { earth: 'Erde', cetus: 'Cetus', vallis: 'Orb Vallis', cambion: 'Cambion Drift' };
const NEXT = { day: 'Tag', night: 'Nacht', warm: 'Warm', cold: 'Kalt', fass: 'Fass', vome: 'Vome' };
const FLIP = { day: 'night', night: 'day', warm: 'cold', cold: 'warm', fass: 'vome', vome: 'fass' };
const BARO_KEY = 'td.notify.baro';
const ROUND_KEY = 'td.notify.rounds'; // { sortie: id, archon: id } – zuletzt gemeldete Runde

function send(title, body) {
  try {
    if (Notification.permission === 'denied') return;
    new Notification(title, { body, silent: false });
  } catch {
    /* Benachrichtigungen nicht verfügbar */
  }
}

/** Prüft bei jeder Aktualisierung der Uhr, ob etwas gemeldet werden muss. */
export function useWorldNotifications(world, now) {
  const s = useSettings();
  const sent = useRef(new Set()); // "cetus|<expiry>" – jede Meldung nur einmal
  useBaroDucatNotification(world, now); // einige Stunden vorher: Ducats zum Opfern

  useEffect(() => {
    if (!s.notify) return;
    for (const key of Object.keys(PLACES)) {
      const c = world[key];
      if (!s.notifyCycles[key] || !c?.expiry || !c.state) continue;
      const left = new Date(c.expiry).getTime() - now;
      const id = `${key}|${c.expiry}`;
      if (left > 0 && left <= s.notifyMinutes * 60_000 + 1000 && !sent.current.has(id)) {
        sent.current.add(id);
        const next = NEXT[FLIP[c.state]] ?? 'Wechsel';
        const mins = Math.max(1, Math.round(left / 60_000));
        send(`${PLACES[key]}: ${next} in ${mins} Min.`, `Gerade: ${NEXT[c.state] ?? c.state}`);
      }
    }
    const baro = world.baro;
    if (s.notifyBaro && baro?.activation) {
      const since = now - new Date(baro.activation).getTime();
      // Nur kurz nach der Ankunft melden und pro Besuch einmal (auch über Neustarts hinweg)
      if (since >= 0 && since < 60 * 60_000 && load(BARO_KEY, null) !== baro.activation) {
        save(BARO_KEY, baro.activation);
        send("Baro Ki'Teer ist da", `${baro.location ?? 'Relais'} – bleibt bis ${new Date(baro.expiry).toLocaleString('de-DE')}`);
      }
    }
    // Neue Sortie / Archon-Jagd: in der ersten Stunde einmal melden (auch über Neustarts hinweg)
    const rounds = load(ROUND_KEY, {});
    for (const [kind, on, title] of [
      ['sortie', s.notifySortie, 'Neue Sortie: {boss}'],
      ['archon', s.notifyArchon, 'Neue Archon-Jagd: {boss}'],
    ]) {
      const r = world[kind];
      if (!on || !r?.id || rounds[kind] === r.id) continue;
      const since = now - new Date(r.activation).getTime();
      if (since < 0 || since > 60 * 60_000) continue;
      save(ROUND_KEY, { ...load(ROUND_KEY, {}), [kind]: r.id });
      send(translate(s.language, title, { boss: r.boss }), r.missions.map((m) => `${m.missionType} (${m.node})`).join(' · '));
    }
  }, [world, now, s]);
}

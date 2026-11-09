// "Baro kommt in 3 Std. – du hast 1.234 Ducats zum Opfern": einige Stunden vor seiner Ankunft, pro Besuch einmal.
// Läuft im Hauptfenster (braucht Mastery-Datenbank + Inventar), gesendet wird über den Rust-Teil.
import { createEffect } from 'solid-js';
import { world, now } from './world.js';
import { game } from './game.js';
import { settings } from './settings.js';
import { loadMasteryDb } from './gamedb.js';
import { spareParts } from './trade.js';
import { translate } from './i18n.js';
import { call, isTauri, load, save } from './ipc.js';

const AHEAD_HOURS = 3;
const KEY = 'cm.notify.baroDucats';

export function useBaroDucatReminder() {
  createEffect(() => {
    const baro = world.baro;
    const inv = game.inventory;
    if (!isTauri || !settings.notify || !settings.notifyBaroDucats || !baro?.activation || !inv) return;
    const left = new Date(baro.activation).getTime() - now();
    if (left <= 0 || left > AHEAD_HOURS * 3600_000 || load(KEY, null) === baro.activation) return;
    save(KEY, baro.activation);
    const lang = settings.language;
    loadMasteryDb()
      .then((db) => {
        const ducats = spareParts(db, inv).reduce((sum, p) => sum + p.ducats * p.spare, 0);
        if (!ducats) return;
        const h = Math.floor(left / 3600_000);
        const m = Math.round((left % 3600_000) / 60_000);
        const when = h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
        call('notify_send', {
          kind: 'baro',
          title: translate(lang, 'Baro kommt in {t}', { t: when }),
          body: translate(lang, 'Du hast {n} Ducats zum Opfern ({place}).', {
            n: ducats.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE'),
            place: baro.location ?? 'Relais',
          }),
        }).catch(() => {});
      })
      .catch(() => {});
  });
}

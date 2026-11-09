import { useEffect } from 'react';
import { load, save } from './api.js';
import { useSettings } from './settings.js';
import { useGameData } from './GameData.jsx';
import { loadMasteryDb } from './masteryDb.js';
import { spareParts } from './trade.js';
import { translate } from './i18n.js';

// "Baro kommt in 3 Std. – du hast 1.234 Ducats zum Opfern": einige Stunden vor seiner Ankunft, pro Besuch einmal.

export const BARO_AHEAD_HOURS = 3;
const KEY = 'td.notify.baroDucats';

export function useBaroDucatNotification(world, now) {
  const s = useSettings();
  const { inventory } = useGameData() ?? {};
  const baro = world?.baro;

  useEffect(() => {
    if (!s.notify || !s.notifyBaroDucats || !baro?.activation || !inventory) return;
    const left = new Date(baro.activation).getTime() - now;
    if (left <= 0 || left > BARO_AHEAD_HOURS * 3600_000 || load(KEY, null) === baro.activation) return;
    save(KEY, baro.activation);
    loadMasteryDb()
      .then((db) => {
        const ducats = spareParts(db, inventory).reduce((sum, p) => sum + p.ducats * p.spare, 0);
        if (!ducats) return;
        const h = Math.floor(left / 3600_000);
        const m = Math.round((left % 3600_000) / 60_000);
        const when = h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
        const title = translate(s.language, 'Baro kommt in {t}', { t: when });
        const body = translate(s.language, 'Du hast {n} Ducats zum Opfern ({place}).', {
          n: ducats.toLocaleString(s.language === 'en' ? 'en-US' : 'de-DE'),
          place: baro.location ?? 'Relais',
        });
        try {
          if (Notification.permission !== 'denied') new Notification(title, { body });
        } catch {
          /* Benachrichtigungen nicht verfügbar */
        }
      })
      .catch(() => {});
  }, [world, now, s, inventory, baro]);
}

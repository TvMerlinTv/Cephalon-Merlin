// Hinweis in der Titelleiste, solange keine Internetverbindung besteht.
// Der Rust-Teil meldet den Zustand ("net-status"); der Weltstatus kommt dann aus dem letzten Stand.
import { createSignal, Show } from 'solid-js';
import { WifiOff } from 'lucide-solid';
import { call, isTauri, on } from '../lib/ipc.js';
import { world } from '../lib/world.js';
import { t } from '../lib/i18n.js';
import { settings } from '../lib/settings.js';

const [net, setNet] = createSignal({ online: true, since: null });
if (isTauri) {
  call('net_status').then(setNet).catch(() => {});
  on('net-status', setNet);
}
export { net };

const time = (ms) =>
  new Date(ms).toLocaleString(settings.language === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function NetBadge() {
  const offline = () => !net().online || world.offline === true;
  const tip = () =>
    [
      t('Keine Internetverbindung – neuer Versuch alle 20 Sekunden.'),
      t('Zyklen werden weiter berechnet. Spalten, Sortie, Baro und Preise sind vom letzten Stand.'),
      net().since ? t('Offline seit {t}', { t: time(net().since) }) : '',
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <Show when={offline()}>
      <span class="badge badge-offline" title={tip()}>
        <WifiOff size={13} /> {t('Offline')}
        <Show when={world.dataAt}> · {t('Stand {t}', { t: time(world.dataAt) })}</Show>
      </span>
    </Show>
  );
}

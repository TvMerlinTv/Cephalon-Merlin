// Sync-Knopf in der Titelleiste: Status + Zeit seit dem letzten Sync (zählt jede Sekunde hoch).
import { createSignal, Match, Switch } from 'solid-js';
import { RefreshCw, CircleCheck, TriangleAlert, LoaderCircle } from 'lucide-solid';
import { game, syncGame } from '../lib/game.js';
import { t } from '../lib/i18n.js';
import { settings } from '../lib/settings.js';

const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 1000);
export { now };

// 0:42 · 12:05 · 1:02:33 · 3d 16:05:12
function since(at) {
  const sec = Math.max(0, Math.floor((now() - at) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  const hms = `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return d ? `${d}d ${hms}` : h ? hms : `${m}:${ss}`;
}

export default function SyncBadge() {
  const lastSync = () =>
    new Date(game.inventory.syncedAt).toLocaleString(settings.language === 'en' ? 'en-GB' : 'de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  return (
    <Switch
      fallback={
        <button class="badge badge-idle" onClick={syncGame}>
          <RefreshCw size={13} /> {t('Mit Spiel synchronisieren')}
        </button>
      }
    >
      <Match when={game.syncing}>
        <span class="badge badge-busy">
          <LoaderCircle size={13} class="spin" /> {t('Lese Spieldaten …')}
        </span>
      </Match>
      <Match when={game.error}>
        <button class="badge badge-error" onClick={syncGame} title={t(game.error)}>
          <TriangleAlert size={13} /> {t('Sync fehlgeschlagen – erneut')}
        </button>
      </Match>
      <Match when={game.inventory}>
        <button
          class="badge badge-ok"
          onClick={syncGame}
          title={`${t('Letzter Sync: {t}', { t: lastSync() })} – ${t('Erneut aus dem Spiel lesen')}`}
        >
          <CircleCheck size={13} /> {t('WF Sync')} · <span class="sync-since">{since(game.inventory.syncedAt)}</span> <RefreshCw size={12} />
        </button>
      </Match>
    </Switch>
  );
}

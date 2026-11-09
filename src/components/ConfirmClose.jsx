// Nachfrage beim Schließen (Einstellung "confirmClose"), wie in der Electron-Version.
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { settings, setSettings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { isTauri } from '../lib/ipc.js';

export default function ConfirmClose() {
  const [open, setOpen] = createSignal(false);
  const [dontAsk, setDontAsk] = createSignal(false);
  if (!isTauri) return null;
  const win = getCurrentWindow();
  let unlisten;
  onMount(async () => {
    unlisten = await win.onCloseRequested((e) => {
      if (!settings.confirmClose) return;
      e.preventDefault();
      setOpen(true);
    });
  });
  onCleanup(() => unlisten?.());
  const quit = async () => {
    if (dontAsk()) await setSettings({ confirmClose: false });
    await win.destroy();
  };
  const onKey = (e) => open() && e.key === 'Escape' && setOpen(false);
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  return (
    <Show when={open()}>
      <div class="modal-backdrop" onClick={() => setOpen(false)}>
        <div class="modal confirm-close" onClick={(e) => e.stopPropagation()}>
          <div class="modal-head">
            <h3>{t('Cephalon Merlin wirklich beenden?')}</h3>
          </div>
          <p class="muted">{t('Damit verschwindet auch das Ingame-Overlay.')}</p>
          <label class="set-row">
            <input type="checkbox" checked={dontAsk()} onChange={(e) => setDontAsk(e.currentTarget.checked)} />
            <span>{t('Nicht mehr fragen')}</span>
          </label>
          <div class="confirm-actions">
            <button class="btn" onClick={() => setOpen(false)}>
              {t('Abbrechen')}
            </button>
            <button class="btn btn-primary" onClick={quit} autofocus>
              {t('Beenden')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

// Selbst-Update (src-tauri/src/updater.rs): Hinweis in der Titelleiste, „Nach Updates suchen“
// in den Einstellungen/der Hilfe und das Fenster mit Versionshinweisen + „Jetzt aktualisieren“.
import { createSignal, Match, Show, Switch } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ArrowDownCircle, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-solid';
import { call, isTauri, on, openExternal } from '../lib/ipc.js';
import { t } from '../lib/i18n.js';
import Markdown from './Markdown.jsx';
import '../updates.css';

const [update, setUpdate] = createSignal(null);
if (isTauri) {
  call('update_state').then(setUpdate).catch(() => {});
  on('update-state', setUpdate);
}
export { update };

const mb = (b) => `${((b ?? 0) / 1024 / 1024).toFixed(1)} MB`;
const busy = (s) => s === 'downloading' || s === 'installing';

function UpdateDialog(props) {
  const [error, setError] = createSignal(null);
  const s = () => update();
  const latest = () => s().latest;
  const pct = () => {
    const p = s().progress;
    return p?.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  };
  const install = async () => {
    setError(null);
    try {
      await call('update_install');
    } catch (e) {
      setError(e.message ?? String(e));
    }
  };
  return (
    <Portal>
      <div class="modal-backdrop" onClick={() => !busy(s().status) && props.onClose()}>
        <div class="modal update-dialog" onClick={(e) => e.stopPropagation()}>
          <div class="modal-head">
            <h3>{t('Update {v} verfügbar', { v: latest().version })}</h3>
            <button class="icon-btn" onClick={props.onClose} disabled={busy(s().status)} aria-label={t('Schließen')}>
              <X size={18} />
            </button>
          </div>
          <p class="muted">
            {t('Installiert: {v}', { v: s().current })}
            <Show when={latest().asset?.size}> · {t('Download')} {mb(latest().asset.size)}</Show>
          </p>
          <h4>{t('Was ist neu?')}</h4>
          <div class="update-notes">
            <Show when={latest().notes?.trim()} fallback={t('Keine Versionshinweise.')}>
              <Markdown text={latest().notes} />
            </Show>
          </div>
          <Show when={s().status === 'downloading'}>
            <div class="update-progress">
              <div class="update-bar">
                <span style={{ width: `${pct()}%` }} />
              </div>
              <small class="muted">
                {t('Lade herunter …')} {mb(s().progress?.done)}
                <Show when={s().progress?.total}> / {mb(s().progress.total)} ({pct()} %)</Show>
              </small>
            </div>
          </Show>
          <Show when={s().status === 'installing'}>
            <p class="update-installing">
              <LoaderCircle size={15} class="spin" /> {t('Wird installiert – Cephalon Merlin startet gleich neu …')}
            </p>
          </Show>
          <Show when={(error() || s().error) && !busy(s().status)}>
            <p class="err">{error() || s().error}</p>
          </Show>
          <Show when={!s().canInstall}>
            <p class="muted">{t('Aktualisieren geht nur in der fertigen .exe (nicht in der Preview) – lade die neue Version sonst von GitHub.')}</p>
          </Show>
          <div class="update-actions">
            <Show when={latest().url}>
              <button class="btn" onClick={() => openExternal(latest().url)}>
                <ExternalLink size={15} /> {t('Auf GitHub ansehen')}
              </button>
            </Show>
            <Show when={s().canInstall}>
              <button class="btn btn-primary" onClick={install} disabled={busy(s().status)}>
                {busy(s().status) ? <LoaderCircle size={15} class="spin" /> : <ArrowDownCircle size={15} />} {t('Jetzt aktualisieren')}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Dezenter Hinweis in der Titelleiste, nur wenn ein Update bereitliegt. */
export function UpdateBadge() {
  const [open, setOpen] = createSignal(false);
  const show = () => update()?.latest && ['available', 'downloading', 'installing'].includes(update().status);
  return (
    <Show when={show()}>
      <button class="badge badge-update" onClick={() => setOpen(true)} title={t('Versionshinweise und Aktualisieren')}>
        <ArrowDownCircle size={13} /> {t('Update {v}', { v: update().latest.version })}
      </button>
      <Show when={open()}>
        <UpdateDialog onClose={() => setOpen(false)} />
      </Show>
    </Show>
  );
}

/** „Nach Updates suchen“ mit Ergebnis. */
export function UpdateCheck() {
  const [open, setOpen] = createSignal(false);
  const [checked, setChecked] = createSignal(false);
  const s = () => update();
  const status = () => s()?.status;
  const check = async () => {
    setChecked(true);
    const r = await call('update_check').catch(() => null);
    if (r?.status === 'available' && r.latest) setOpen(true);
  };
  return (
    <Show when={isTauri && s()}>
      <div class="update-check">
        <button class="btn" onClick={check} disabled={status() === 'checking' || busy(status())}>
          {status() === 'checking' ? <LoaderCircle size={15} class="spin" /> : <RefreshCw size={15} />} {t('Nach Updates suchen')}
        </button>
        <Switch>
          <Match when={status() === 'checking'}>
            <span class="muted">{t('Suche nach Updates …')}</span>
          </Match>
          <Match when={['available', 'downloading', 'installing'].includes(status()) && s().latest}>
            <button class="link-btn" onClick={() => setOpen(true)}>
              <ArrowDownCircle size={14} /> {t('Update {v} verfügbar – Details', { v: s().latest.version })}
            </button>
          </Match>
          <Match when={status() === 'error'}>
            <span class="err">{s().error}</span>
          </Match>
          <Match when={status() === 'none' && s().noRelease && (checked() || s().checkedAt)}>
            <span class="muted">{t('Noch keine Rust-Version auf GitHub veröffentlicht.')}</span>
          </Match>
          <Match when={status() === 'none' && (checked() || s().checkedAt)}>
            <span class="ok">
              <CheckCircle2 size={14} /> {t('Du hast die neueste Version ({v}).', { v: s().current })}
            </span>
          </Match>
        </Switch>
        <Show when={open() && s()?.latest}>
          <UpdateDialog onClose={() => setOpen(false)} />
        </Show>
      </div>
    </Show>
  );
}

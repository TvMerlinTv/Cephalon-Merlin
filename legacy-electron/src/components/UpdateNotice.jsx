import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { openExternal } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { updates, updatesSupported, useUpdate, formatMb } from '../lib/updates.js';
import './UpdateNotice.css';

/** Versionshinweise + „Jetzt aktualisieren“ (mit Download-Fortschritt). */
function UpdateDialog({ state, onClose }) {
  const t = useT();
  const [error, setError] = useState(null);
  const { latest, status, progress } = state;
  const working = status === 'downloading' || status === 'installing';
  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const install = async () => {
    setError(null);
    try {
      await updates.install();
    } catch (e) {
      setError(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  // Portal an <body>: in der Titelleiste würde die Zieh-Fläche (app-region: drag) sonst Klicks schlucken
  return createPortal(
    <div className="modal-backdrop" onClick={working ? undefined : onClose}>
      <div className="modal update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Update {v} verfügbar', { v: latest.version })}</h3>
          <button className="icon-btn" onClick={onClose} disabled={working} aria-label={t('Schließen')}>
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          {t('Installiert: {v}', { v: state.current })}
          {latest.small?.size
            ? ` · ${t('Kleines Update')} ${formatMb(latest.small.size)}`
            : latest.asset?.size
              ? ` · ${t('Download')} ${formatMb(latest.asset.size)}`
              : ''}
        </p>
        <h4>{t('Was ist neu?')}</h4>
        <pre className="update-notes">{latest.notes?.trim() || t('Keine Versionshinweise.')}</pre>

        {status === 'downloading' && (
          <div className="update-progress">
            <div className="update-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <small className="muted">
              {t('Lade herunter …')} {formatMb(progress?.done ?? 0)}
              {progress?.total ? ` / ${formatMb(progress.total)} (${pct} %)` : ''}
            </small>
          </div>
        )}
        {status === 'installing' && (
          <p className="update-installing">
            <Loader2 size={15} className="spin" /> {t('Wird installiert – Cephalon Merlin startet gleich neu …')}
          </p>
        )}
        {(error || state.error) && !working && <p className="err">{error || state.error}</p>}
        {!state.canInstall && <p className="muted">{t('Aktualisieren geht nur in der portablen .exe – lade die neue Version sonst von GitHub.')}</p>}

        <div className="update-actions">
          {latest.url && (
            <button className="btn" onClick={() => openExternal(latest.url)}>
              <ExternalLink size={15} /> {t('Auf GitHub ansehen')}
            </button>
          )}
          {state.canInstall && (
            <button className="btn btn-primary" onClick={install} disabled={working}>
              {working ? <Loader2 size={15} className="spin" /> : <ArrowDownCircle size={15} />} {t('Jetzt aktualisieren')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Dezenter Hinweis in der Titelleiste, nur wenn ein Update bereitliegt. */
export function UpdateBadge() {
  const t = useT();
  const state = useUpdate();
  const [open, setOpen] = useState(false);
  const show = state?.latest && ['available', 'downloading', 'installing'].includes(state.status);
  if (!show) return null;
  return (
    <>
      <button className="badge badge-update" onClick={() => setOpen(true)} title={t('Versionshinweise und Aktualisieren')}>
        <ArrowDownCircle size={13} /> {t('Update {v}', { v: state.latest.version })}
      </button>
      {open && <UpdateDialog state={state} onClose={() => setOpen(false)} />}
    </>
  );
}

/** „Nach Updates suchen“ mit Ergebnis (Hilfe/Info). */
export function UpdateCheck() {
  const t = useT();
  const state = useUpdate();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  if (!updatesSupported) return null;

  const status = state?.status;
  const check = async () => {
    setChecked(true);
    const s = await updates.check().catch(() => null);
    // Update gefunden → gleich das Fenster mit „Jetzt aktualisieren“ zeigen
    if (s?.status === 'available' && s.latest) setOpen(true);
  };

  let result = null;
  if (status === 'checking') result = <span className="muted"><Loader2 size={14} className="spin" /> {t('Suche nach Updates …')}</span>;
  else if (status === 'off') result = <span className="muted">{t('Update-Prüfung ist aus (kein GitHub-Repository eingestellt).')}</span>;
  else if (['available', 'downloading', 'installing'].includes(status) && state.latest)
    result = (
      <button className="link-btn" onClick={() => setOpen(true)}>
        <ArrowDownCircle size={14} /> {t('Update {v} verfügbar – Details', { v: state.latest.version })}
      </button>
    );
  else if (status === 'error') result = <span className="err">{state.error}</span>;
  else if (status === 'none' && state.noRelease)
    result = <span className="muted">{t('Noch keine Version auf GitHub veröffentlicht.')}</span>;
  else if (status === 'none' && state.latest?.newer && !state.latest.asset)
    result = <span className="muted">{t('Version {v} ist erschienen, enthält aber keine .exe.', { v: state.latest.version })}</span>;
  else if (status === 'none' && (checked || state.checkedAt))
    result = <span className="ok"><CheckCircle2 size={14} /> {t('Du hast die neueste Version ({v}).', { v: state.current })}</span>;

  return (
    <div className="update-check">
      <button className="btn" onClick={check} disabled={status === 'checking' || status === 'downloading' || status === 'installing'}>
        {status === 'checking' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {t('Nach Updates suchen')}
      </button>
      {result}
      {open && state?.latest && <UpdateDialog state={state} onClose={() => setOpen(false)} />}
    </div>
  );
}

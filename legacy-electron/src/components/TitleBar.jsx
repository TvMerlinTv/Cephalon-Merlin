import { Minus, Plus, Square, X, RefreshCw, CheckCircle2, AlertTriangle, Loader2, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { isElectron } from '../lib/api.js';
import { useGameData } from '../lib/GameData.jsx';
import { Logo } from './Icons.jsx';
import { useT } from '../lib/i18n.js';
import { useSettings } from '../lib/settings.js';
import { useDraftSave } from '../lib/theme.js';
import { UpdateBadge } from './UpdateNotice.jsx';

function SyncBadge() {
  const t = useT();
  const { inventory, syncing, error, sync } = useGameData();
  if (syncing) {
    return (
      <span className="badge badge-busy">
        <Loader2 size={13} className="spin" /> {t('Lese Spieldaten …')}
      </span>
    );
  }
  if (error) {
    return (
      <button className="badge badge-error" onClick={sync} title={error}>
        <AlertTriangle size={13} /> {t('Sync fehlgeschlagen – erneut')}
      </button>
    );
  }
  if (inventory) {
    const at = new Date(inventory.syncedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return (
      <button className="badge badge-ok" onClick={sync} title={t('Erneut aus dem Spiel lesen')}>
        <CheckCircle2 size={13} /> {t('WF-Daten OK')} · {at} <RefreshCw size={12} />
      </button>
    );
  }
  return (
    <button className="badge badge-idle" onClick={sync}>
      <RefreshCw size={13} /> {t('Mit Spiel synchronisieren')}
    </button>
  );
}

// Größe der Oberfläche: −  Regler  +  (Klick auf die Prozentzahl = 100 %)
// 1 % … 200 %; die Knöpfe springen auf volle 10 %
const MIN = 0.01;
const MAX = 2;
function ZoomControl() {
  const t = useT();
  const [s, change] = useDraftSave(useSettings());
  const z = s.uiScale ?? 1;
  const set = (v) => change({ uiScale: Math.round(Math.min(MAX, Math.max(MIN, v)) * 100) / 100 });
  return (
    <div className="zoom-ctl" title={t('Größe der Oberfläche')}>
      <button onClick={() => set(Math.ceil(z * 10 - 1e-6) / 10 - 0.1)} disabled={z <= MIN} aria-label={t('Kleiner')}>
        <Minus size={14} />
      </button>
      <input type="range" min={MIN} max={MAX} step={0.01} value={z} onChange={(e) => set(Number(e.target.value))} />
      <button onClick={() => set(Math.floor(z * 10 + 1e-6) / 10 + 0.1)} disabled={z >= MAX} aria-label={t('Größer')}>
        <Plus size={14} />
      </button>
      <button className="zoom-pct" onClick={() => set(1)} title={t('Auf 100 % zurücksetzen')}>
        {Math.round(z * 100)}%
      </button>
    </div>
  );
}

export default function TitleBar({ panelOpen = true, onTogglePanel }) {
  const t = useT();
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <Logo size={22} />
        <span>Cephalon Merlin</span>
        <SyncBadge />
        <UpdateBadge />
      </div>
      <div className="titlebar-drag" />
      <ZoomControl />
      {onTogglePanel && (
        <button
          className={`panel-toggle ${panelOpen ? 'active' : ''}`}
          onClick={onTogglePanel}
          title={t(panelOpen ? 'Timer/Relikte ausblenden' : 'Timer/Relikte einblenden')}
        >
          {panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      )}
      {isElectron && (
        <div className="titlebar-controls">
          <button onClick={() => window.wf.window('minimize')} aria-label={t('Minimieren')}>
            <Minus size={16} />
          </button>
          <button onClick={() => window.wf.window('maximize')} aria-label={t('Maximieren')}>
            <Square size={13} />
          </button>
          <button className="close" onClick={() => window.wf.window('close')} aria-label={t('Schließen')}>
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  );
}

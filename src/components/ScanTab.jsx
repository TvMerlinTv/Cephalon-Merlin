import { useEffect, useState } from 'react';
import { ScanLine, Image as ImageIcon, Loader2 } from 'lucide-react';
import { isElectron } from '../lib/api.js';
import { useRewardInfo } from '../lib/rewardInfo.js';
import { useSettings, keyLabel } from '../lib/settings.js';
import { RewardColumn, SelectionPanel } from './ScanViews.jsx';
import { useT } from '../lib/i18n.js';

/** Letzter Overlay-Scan im rechten Panel – auch nützlich, wenn das Spiel im exklusiven Vollbild läuft. */
export function useLastScan() {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!isElectron) return;
    window.wf.lastScan().then((r) => r && setResult(r));
    return window.wf.onScan(setResult);
  }, []);
  return result;
}

export default function ScanTab({ result }) {
  const t = useT();
  const ri = useRewardInfo();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="timer-scroll scan-tab">
      <p className="muted small">
        {t('Drück im Spiel')} <kbd>{keyLabel(settings.hotkey, settings.language)}</kbd>{' '}
        {t('bei der Relikt-Auswahl. Der Belohnungs-Bildschirm nach der Mission wird automatisch erkannt. Das Overlay ist nur im Fenster- oder randlosen Modus sichtbar.')}
      </p>
      {isElectron ? (
        <div className="scan-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(window.wf.scanNow)}>
            {busy ? <Loader2 size={15} className="spin" /> : <ScanLine size={15} />} {t('Jetzt scannen')}
          </button>
          <button className="btn" disabled={busy} onClick={() => run(window.wf.scanFile)}>
            <ImageIcon size={15} /> {t('Screenshot testen')}
          </button>
        </div>
      ) : (
        <p className="notice">{t('Scannen geht nur in der Desktop-App.')}</p>
      )}

      {result?.mode === 'error' && <p className="err">{result.error}</p>}
      {result?.mode === 'none' && <p className="muted">{t('Kein Relikt-Bildschirm erkannt.')}</p>}
      {ri.ready && result?.mode === 'rewards' && (
        <div className="scan-list">
          {(() => {
            const infos = result.items.map((it) => ri.info(it.name));
            const best = ri.pick(infos);
            return infos.map((info, i) => <RewardColumn key={i} info={info} best={info === best} />);
          })()}
        </div>
      )}
      {ri.ready && result?.mode === 'selection' && <SelectionPanel result={result} ri={ri} />}
    </div>
  );
}

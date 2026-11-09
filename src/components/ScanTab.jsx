// Reiter "Relikte" im Timer-Panel: letzter Overlay-Scan – auch nützlich im exklusiven Vollbild.
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { ScanLine, Image as ImageIcon, LoaderCircle } from 'lucide-solid';
import { createRewardInfo } from '../lib/rewardInfo.js';
import { settings, keyLabel } from '../lib/settings.js';
import { call, isTauri, on } from '../lib/ipc.js';
import { RewardColumn, SelectionPanel } from './ScanViews.jsx';
import { t } from '../lib/i18n.js';

const [lastScan, setLastScan] = createSignal(null);
export { lastScan };
if (isTauri) {
  call('scan_last').then((r) => r && setLastScan(r)).catch(() => {});
  on('scan', setLastScan);
}

export default function ScanTab() {
  const ri = createRewardInfo();
  const [busy, setBusy] = createSignal(false);
  const run = async (cmd) => {
    setBusy(true);
    try {
      await call(cmd);
    } finally {
      setBusy(false);
    }
  };
  const r = () => lastScan();
  return (
    <div class="timer-scroll scan-tab">
      <p class="muted small">
        {t('Drück im Spiel')} <kbd>{keyLabel(settings.hotkey, settings.language)}</kbd>{' '}
        {t('bei der Relikt-Auswahl. Der Belohnungs-Bildschirm nach der Mission wird automatisch erkannt. Das Overlay ist nur im Fenster- oder randlosen Modus sichtbar.')}
      </p>
      <div class="scan-actions">
        <button class="btn btn-primary" disabled={busy() || !isTauri} onClick={() => run('scan_now')}>
          {busy() ? <LoaderCircle size={15} class="spin" /> : <ScanLine size={15} />} {t('Jetzt scannen')}
        </button>
        <button class="btn" disabled={busy() || !isTauri} onClick={() => run('scan_file')}>
          <ImageIcon size={15} /> {t('Screenshot testen')}
        </button>
      </div>
      <Switch>
        <Match when={r()?.mode === 'error'}>
          <p class="err">{t(r().error)}</p>
        </Match>
        <Match when={r()?.mode === 'none'}>
          <p class="muted">{t('Kein Relikt-Bildschirm erkannt.')}</p>
        </Match>
        <Match when={ri().ready && r()?.mode === 'rewards'}>
          <div class="scan-list">
            {(() => {
              const infos = r().items.map((it) => ri().info(it.name));
              const best = ri().pick(infos);
              return <For each={infos}>{(info) => <RewardColumn info={info} best={info === best} />}</For>;
            })()}
          </div>
        </Match>
        <Match when={ri().ready && r()?.mode === 'selection'}>
          <SelectionPanel result={r()} ri={ri()} />
        </Match>
      </Switch>
      <Show when={ri().error}>
        <p class="err small">{ri().error}</p>
      </Show>
    </div>
  );
}

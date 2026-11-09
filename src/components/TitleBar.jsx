// Eigene Titelleiste (Fenster ohne Rahmen): Logo, Größen-Regler, Fensterknöpfe.
// Ziehen über data-tauri-drag-region, Doppelklick maximiert.
import { Show } from 'solid-js';
import { Minus, Plus, Square, X } from 'lucide-solid';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Logo } from './Icons.jsx';
import { t } from '../lib/i18n.js';
import { isTauri } from '../lib/ipc.js';
import { createDraft } from '../lib/theme.js';

// Größe der Oberfläche: −  Regler  +  (Klick auf die Prozentzahl = 100 %). 1 % … 200 %.
const MIN = 0.01;
const MAX = 2;
function ZoomControl() {
  const [s, change] = createDraft();
  const z = () => s().uiScale ?? 1;
  const set = (v) => change({ uiScale: Math.round(Math.min(MAX, Math.max(MIN, v)) * 100) / 100 });
  return (
    <div class="zoom-ctl" title={t('Größe der Oberfläche')}>
      <button onClick={() => set(Math.ceil(z() * 10 - 1e-6) / 10 - 0.1)} disabled={z() <= MIN} aria-label={t('Kleiner')}>
        <Minus size={14} />
      </button>
      <input type="range" min={MIN} max={MAX} step={0.01} value={z()} onInput={(e) => set(Number(e.currentTarget.value))} />
      <button onClick={() => set(Math.floor(z() * 10 + 1e-6) / 10 + 0.1)} disabled={z() >= MAX} aria-label={t('Größer')}>
        <Plus size={14} />
      </button>
      <button class="zoom-pct" onClick={() => set(1)} title={t('Auf 100 % zurücksetzen')}>
        {Math.round(z() * 100)}%
      </button>
    </div>
  );
}

export default function TitleBar(props) {
  const win = isTauri ? getCurrentWindow() : null;
  return (
    <header class="titlebar" data-tauri-drag-region>
      <div class="titlebar-brand" data-tauri-drag-region>
        <Logo size={22} />
        <span data-tauri-drag-region>Cephalon Merlin</span>
        <span class="badge badge-rs" title={t('Rust-Version (Vorschau)')}>RS</span>
        {props.left}
      </div>
      <div class="titlebar-drag" data-tauri-drag-region />
      <ZoomControl />
      {props.right}
      <Show when={win}>
        <div class="titlebar-controls">
          <button onClick={() => win.minimize()} aria-label={t('Minimieren')}>
            <Minus size={16} />
          </button>
          <button onClick={() => win.toggleMaximize()} aria-label={t('Maximieren')}>
            <Square size={13} />
          </button>
          <button class="close" onClick={() => win.close()} aria-label={t('Schließen')}>
            <X size={16} />
          </button>
        </div>
      </Show>
    </header>
  );
}

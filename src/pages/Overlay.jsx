// Durchsichtiges Vollbild-Fenster über dem Spiel (Label "overlay"). Koordinaten aus der OCR sind
// Bildschirm-Pixel, das Fenster rechnet in CSS-Pixeln (geteilt durch den Windows-Skalierungsfaktor).
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { createRewardInfo } from '../lib/rewardInfo.js';
import { rewardCells } from '../lib/rewardCells.js';
import { settings } from '../lib/settings.js';
import { call, on } from '../lib/ipc.js';
import { t } from '../lib/i18n.js';
import { RewardsPanel, SelectionPanel, RewardTag } from '../components/ScanViews.jsx';

function rewardsLayout(result) {
  const { items, screen } = result;
  const s = screen.scale || 1;
  const centers = items.map((it) => it.x + it.w / 2);
  const gap = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : screen.height * 0.225;
  const colW = Math.min(gap, screen.height * 0.24);
  const bottom = Math.max(...items.map((it) => it.y + it.h));
  // unter den Spielernamen (4 Zeilen) – wie AlecaFrame
  return { left: `${(centers[0] - colW / 2) / s}px`, top: `${(bottom + screen.height * 0.17) / s}px`, width: `${(colW * items.length) / s}px` };
}

export default function Overlay() {
  const ri = createRewardInfo();
  const [result, setResult] = createSignal(null);
  let root;

  onMount(() => {
    document.documentElement.classList.add('overlay-mode');
    call('scan_last').then((r) => r && setResult(r)).catch(() => {});
    on('scan', (r) => setResult(r));
  });

  // Flächen unserer Schilder melden: falls das Overlay doch in der Aufnahme landet, schwärzt der Rust-Teil sie
  createEffect(() => {
    result();
    queueMicrotask(() => {
      const dpr = window.devicePixelRatio || 1;
      const rects = [...(root?.querySelectorAll('.ov-anchor > *') ?? [])]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return [Math.floor(b.left * dpr) - 2, Math.floor(b.top * dpr) - 2, Math.ceil(b.width * dpr) + 4, Math.ceil(b.height * dpr) + 4];
        })
        .filter((r) => r[2] > 4 && r[3] > 4);
      call('overlay_rects', { rects }).catch(() => {});
    });
  });

  const r = () => result();
  const ready = () => ri().ready;

  // Einstellung „Belohnungs-Infos kopieren“: einmal pro Belohnungs-Bildschirm, für den Squad-Chat.
  // Kurz warten, damit gerade geladene Preise schon drin sind; geschrieben wird im Rust-Teil
  // (das Overlay hat nie den Fokus, navigator.clipboard ginge hier nicht).
  let copiedAt = null;
  createEffect(() => {
    const res = r();
    if (!ready() || res?.mode !== 'rewards' || !settings.copyRewards || !res.items?.length || copiedAt === res.at) return;
    copiedAt = res.at;
    setTimeout(() => {
      if (result()?.at !== res.at) return;
      const text = res.items
        .map((it) => {
          const info = ri().info(it.name);
          return `${info.name}: ${info.plat != null ? Math.round(info.plat) + 'p' : '?'} / ${info.ducats ?? 0}d`;
        })
        .join(' | ');
      call('copy_text', { text, reason: 'rewards' }).catch(() => {});
    }, 1200);
  });
  const scale = () => r()?.screen?.scale || 1;

  return (
    <div class="overlay-root" ref={root}>
      <Show when={ready() && r()?.mode === 'rewards'}>
        <div class="ov-anchor" style={rewardsLayout(r())}>
          {/* Größe aus den Einstellungen; die Breite bleibt an den 4 Belohnungen im Spiel ausgerichtet */}
          <div style={{ zoom: settings.rewardsScale }}>
            <RewardsPanel result={r()} ri={ri()} showWallet={settings.walletOnOverlay} />
          </div>
        </div>
      </Show>
      <Show when={ready() && r()?.mode === 'selection'}>
        <div class="ov-anchor ov-topright">
          <SelectionPanel result={r()} ri={ri()} compact />
        </div>
        <For each={r().tiles ?? []}>
          {(tile) => {
            const prog = () => ri().relicProgress(tile.relicId);
            const H = () => r().screen.height;
            // Halb herausgescrollte Kachel: keine Zahl
            const visible = () => prog().total > 0 && tile.y + tile.h - H() * 0.146 >= H() * 0.18;
            return (
              <Show when={visible()}>
                <div
                  class="ov-anchor ov-tag"
                  style={{ left: `${(tile.x + tile.w / 2 + H() * 0.048) / scale()}px`, top: `${(tile.y + tile.h - H() * 0.146) / scale()}px` }}
                >
                  <span
                    class={`tile-badge ${prog().done === prog().total ? 'all' : prog().done === 0 ? 'none' : 'some'}`}
                    title={t('Gemeistert / Teile (ohne Forma)')}
                  >
                    {prog().done}/{prog().total}
                  </span>
                </div>
              </Show>
            );
          }}
        </For>
        <Show when={r().relicId && ri().relicById(r().relicId)}>
          {(relic) => (
            <For each={rewardCells(r(), relic())}>
              {(cell) => (
                <div class="ov-anchor ov-tag" style={{ left: `${cell.x / scale()}px`, top: `${cell.y / scale()}px` }}>
                  <RewardTag info={ri().info(cell.name)} />
                </div>
              )}
            </For>
          )}
        </Show>
      </Show>
    </div>
  );
}

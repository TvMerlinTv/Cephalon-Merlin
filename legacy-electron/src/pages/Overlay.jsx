import { useEffect, useLayoutEffect, useState } from 'react';
import { isElectron } from '../lib/api.js';
import { useRewardInfo } from '../lib/rewardInfo.js';
import { useGameData } from '../lib/GameData.jsx';
import { rewardCells } from '../lib/rewardCells.js';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { RewardsPanel, SelectionPanel, RewardTag } from '../components/ScanViews.jsx';

// Durchsichtiges Vollbild-Fenster über dem Spiel. Koordinaten aus der OCR sind Bildschirm-Pixel,
// das Fenster rechnet in CSS-Pixeln (geteilt durch den Windows-Skalierungsfaktor).

/** Browser-Test: #overlay?file=C:\pfad\bild.png zeigt das Bild als Hintergrund und wertet es aus. */
function useTestScan() {
  const file = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('file');
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!file || isElectron) return;
    fetch(`/local/scan-file?path=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then(setResult);
  }, [file]);
  return { file, result };
}

function rewardsLayout(result) {
  const { items, screen } = result;
  const s = screen.scale || 1;
  const centers = items.map((it) => it.x + it.w / 2);
  const gap = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : screen.height * 0.225;
  const colW = Math.min(gap, screen.height * 0.24);
  const bottom = Math.max(...items.map((it) => it.y + it.h));
  return {
    left: (centers[0] - colW / 2) / s,
    // unter den Spielernamen (4 Zeilen) – wie AlecaFrame
    top: (bottom + screen.height * 0.17) / s,
    width: (colW * items.length) / s,
  };
}

export default function Overlay() {
  const ri = useRewardInfo();
  const { reload } = useGameData();
  const test = useTestScan();
  const settings = useSettings();
  const tr = useT(); // "t" ist unten die Laufvariable der Kacheln
  const [result, setResult] = useState(null);

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode');
    if (!isElectron) return;
    window.wf.lastScan().then((r) => r && setResult(r));
    return window.wf.onScan((r) => {
      reload(); // aktuelles Inventar, falls inzwischen synchronisiert wurde
      setResult(r);
    });
  }, [reload]);

  const r = test.result ?? result;

  // Einstellung "Belohnungs-Infos kopieren": einmal pro Belohnungs-Bildschirm
  useEffect(() => {
    if (!isElectron || !ri.ready || r?.mode !== 'rewards' || !settings.copyRewards) return;
    const text = r.items
      .map((it) => {
        const info = ri.info(it.name);
        return `${info.name}: ${info.plat != null ? Math.round(info.plat) + 'p' : '?'} / ${info.ducats ?? 0}d`;
      })
      .join(' | ');
    window.wf.copyText?.(text);
  },[r?.at, ri.ready, settings.copyRewards]);
  const bg = test.file && !isElectron ? `/local/image?path=${encodeURIComponent(test.file)}` : null;

  // Die Bildschirmaufnahme enthält unser Overlay mit. Damit die Texterkennung unsere eigenen
  // Schilder nicht mitliest (und sie dadurch herumspringen), melden wir ihre Flächen.
  useLayoutEffect(() => {
    if (!isElectron) return;
    const dpr = window.devicePixelRatio || 1;
    const rects = [...document.querySelectorAll('.ov-anchor > *')].map((el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.floor(b.left * dpr) - 2, y: Math.floor(b.top * dpr) - 2, w: Math.ceil(b.width * dpr) + 4, h: Math.ceil(b.height * dpr) + 4 };
    });
    window.wf.reportOverlayRects?.(rects.filter((b) => b.w > 4 && b.h > 4));
  });

  return (
    <div className="overlay-root" style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>
      {ri.ready && r?.mode === 'rewards' && (
        <div className="ov-anchor" style={rewardsLayout(r)}>
          {/* Größe aus den Einstellungen; die Breite bleibt an den 4 Belohnungen im Spiel ausgerichtet */}
          <div style={{ zoom: settings.rewardsScale }}>
            <RewardsPanel result={r} ri={ri} showWallet={settings.walletOnOverlay} />
          </div>
        </div>
      )}
      {ri.ready && r?.mode === 'selection' && (
        <>
          <div className="ov-anchor ov-topright">
            <SelectionPanel result={r} ri={ri} />
          </div>
          {(r.tiles ?? []).map((t) => {
            const scale = r.screen?.scale || 1;
            const { done, total } = ri.relicProgress(t.relicId);
            if (!total) return null;
            // Halb herausgescrollte Kachel (oberer Rand über dem Raster, ab ~18,5 % der Höhe): keine Zahl
            if (t.y + t.h - r.screen.height * 0.146 < r.screen.height * 0.18) return null;
            return (
              <div
                key={`${t.relicId}@${t.x},${t.y}`}
                className="ov-anchor ov-tag"
                // rechte obere Ecke der Kachel (links oben steht schon "x17"). Gemessen von der
                // Unterkante des Namens – bei "[Radiant]" ist der Name zweizeilig, endet aber gleich.
                style={{
                  left: (t.x + t.w / 2 + r.screen.height * 0.048) / scale,
                  top: (t.y + t.h - r.screen.height * 0.146) / scale,
                }}
              >
                <span className={`tile-badge ${done === total ? 'all' : done === 0 ? 'none' : 'some'}`} title={tr('Gemeistert / Teile (ohne Forma)')}>
                  {done}/{total}
                </span>
              </div>
            );
          })}
          {(() => {
            const relic = r.relicId ? ri.relicById(r.relicId) : null;
            if (!relic) return null;
            const scale = r.screen?.scale || 1;
            return rewardCells(r, relic).map((cell) => (
              <div key={cell.name} className="ov-anchor ov-tag" style={{ left: cell.x / scale, top: cell.y / scale }}>
                <RewardTag info={ri.info(cell.name)} />
              </div>
            ));
          })()}
        </>
      )}
    </div>
  );
}

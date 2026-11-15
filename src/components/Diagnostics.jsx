// Diagnose (Hilfe-Seite): prüft, was die App zum Arbeiten braucht, und baut einen Bericht zum Kopieren.
// Der Bericht enthält keine Zugangsdaten und keinen Benutzernamen (nur Ja/Nein und Zeiten).
import { createSignal, For, Show } from 'solid-js';
import { CircleCheck, CircleAlert, CircleX, Copy, Check, LoaderCircle, Stethoscope } from 'lucide-solid';
import { call } from '../lib/ipc.js';
import { game } from '../lib/game.js';
import { world } from '../lib/world.js';
import { copyToClipboard } from '../lib/gamedb.js';
import { diagnose, reportText } from '../lib/diagnose.js';
import { t, errText } from '../lib/i18n.js';

const ICON = { ok: CircleCheck, warn: CircleAlert, bad: CircleX };

export default function Diagnostics() {
  const [rows, setRows] = createSignal(null);
  const [raw, setRaw] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [copied, setCopied] = createSignal(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await call('diagnostics');
      setRaw(d);
      setRows(diagnose(d, { syncedAt: game.inventory?.syncedAt ?? null, syncError: game.error, worldAt: world.dataAt ?? world.time ?? null, worldOffline: world.offline === true, now: Date.now() }));
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    // Bericht immer auf Deutsch und ohne Übersetzung – so ist er für Fehlerberichte einheitlich
    await copyToClipboard(reportText(raw(), rows())).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section class="help-card diag">
      <h3>
        <Stethoscope size={15} /> {t('Diagnose')}
      </h3>
      <p class="muted small">{t('Prüft Spiel, EE.log, Internet, warframe.market und den Datenordner. Hilft, wenn etwas nicht funktioniert.')}</p>
      <div class="diag-actions">
        <button class="btn" onClick={run} disabled={busy()}>
          {busy() ? <LoaderCircle size={15} class="spin" /> : <Stethoscope size={15} />} {t(rows() ? 'Erneut prüfen' : 'Jetzt prüfen')}
        </button>
        <Show when={rows()}>
          <button class="btn" onClick={copy} title={t('Bericht für einen Fehlerbericht kopieren (ohne Zugangsdaten)')}>
            {copied() ? <Check size={15} /> : <Copy size={15} />} {t('Bericht kopieren')}
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <p class="err">{errText(error())}</p>
      </Show>
      <Show when={rows()}>
        <ul class="diag-list">
          <For each={rows()}>
            {(r) => {
              const Icon = ICON[r.state];
              return (
                <li class={`diag-${r.state}`}>
                  <Icon size={16} />
                  <span>
                    <b>{t(r.label)}</b>
                    <small class="muted">{t(r.text, r.vars)}</small>
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
}

// Weltstatus als eigene Seite (neu in der Rust-Version): alles auf einen Blick, breiter als im Panel.
import { Show } from 'solid-js';
import { BaroBadge, Cycles, Fissures, WorldTasks } from '../components/WorldWidgets.jsx';
import { world } from '../lib/world.js';
import { t } from '../lib/i18n.js';

export default function World() {
  return (
    <div class="page world-page">
      <Show when={world.time} fallback={<div class="empty">{t('Lade Weltstatus …')}</div>}>
        <div class="world-head">
          <BaroBadge />
          <span class="muted small">
            {t('Quelle: offizieller Warframe-Weltstatus · Stand {t}', {
              t: new Date(world.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })}
          </span>
        </div>
        <div class="world-grid">
          <section class="help-card">
            <Cycles />
            <Fissures />
          </section>
          <section class="help-card">
            <WorldTasks />
          </section>
        </div>
      </Show>
    </div>
  );
}

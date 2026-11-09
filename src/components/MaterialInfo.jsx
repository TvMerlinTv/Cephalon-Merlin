// Info-Fenster zu einem Rohstoff (Neurode, Orokin-Zelle …): wie viel du hast, wo man es farmt, Wiki-Link.
// Öffnen von überall mit openMaterial({ id, name, image, built, count, drops, description }).
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { X, ExternalLink, BookOpen } from 'lucide-solid';
import { wikiFor } from '../lib/gamedb.js';
import { openExternal } from '../lib/ipc.js';
import { t } from '../lib/i18n.js';

const [material, setMaterial] = createSignal(null);
export const openMaterial = (m) => setMaterial(m);

/** Klickbarer Bereich für einen Rohstoff (Klick öffnet das Info-Fenster, ohne die Karte darunter zu öffnen). */
export function materialClick(m) {
  return (e) => {
    e.stopPropagation();
    openMaterial(m);
  };
}

export default function MaterialInfo() {
  const close = () => setMaterial(null);
  const onKey = (e) => e.key === 'Escape' && close();
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (
    <Show when={material()} keyed>
      {(m) => (
        <div class="modal-backdrop" onClick={close}>
          <div class="modal material-info" onClick={(e) => e.stopPropagation()}>
            <div class="modal-head">
              <h3>{t('Rohstoff')}</h3>
              <button class="icon-btn" onClick={close} aria-label={t('Schließen')}>
                <X size={20} />
              </button>
            </div>
            <div class="mi-top">
              <div class="mi-img">
                <Show when={m.image}>
                  <img src={m.image} alt="" />
                </Show>
              </div>
              <div>
                <h2>{m.name}</h2>
                <Show when={m.count != null}>
                  <p class={m.built >= m.count ? 'ok' : 'err'}>
                    {t('Hast du')}: <b>{(m.built ?? 0).toLocaleString('de-DE')}</b> / {t('brauchst')}: <b>{m.count.toLocaleString('de-DE')}</b>
                  </p>
                </Show>
              </div>
            </div>
            <h4>{t('Wie farme ich das?')}</h4>
            <Show when={m.description}>
              <p class="mi-desc">{m.description}</p>
            </Show>
            <Show
              when={m.drops?.length}
              fallback={<p class="muted small">{t('Keine genauen Fundorte in der Item-Datenbank – die Wiki-Seite listet Planeten, Gegner und Händler.')}</p>}
            >
              <table class="drops">
                <thead>
                  <tr>
                    <th>{t('Fundort')}</th>
                    <th>{t('Chance')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={m.drops}>
                    {(d) => (
                      <tr>
                        <td>{d.location}</td>
                        <td class="num">{d.chance != null ? `${d.chance} %` : ''}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
            <div class="mi-actions">
              <button class="btn btn-primary" onClick={() => openExternal(`${wikiFor(m.name)}#Acquisition`)}>
                <BookOpen size={14} /> {t('Wie farme ich das? (Wiki)')} <ExternalLink size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

// Laufende Foundry-Bauaufträge mit Countdown. `wide` = Variante für die Foundry-Seite.
import { createSignal, For, Show } from 'solid-js';
import { Hammer, CircleCheck, Package } from 'lucide-solid';
import { now, countdown } from '../lib/world.js';
import { createFoundry } from '../lib/foundry.js';
import { settings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';

const loc = () => (settings.language === 'en' ? 'en-GB' : 'de-DE');
const hhmm = (ms) => new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
const dayOf = (ms) => new Date(ms).toDateString();

function BuildIcon(props) {
  const [broken, setBroken] = createSignal(false);
  return (
    <Show when={props.src && !broken()} fallback={<Package size={22} class="ft-noimg" />}>
      <img src={props.src} alt="" loading="lazy" onError={() => setBroken(true)} />
    </Show>
  );
}

export default function FoundryTimers(props) {
  const { list, syncedAt } = createFoundry();
  const ready = () => list().filter((b) => b.completesAt && b.completesAt <= now()).length;
  const stand = () => {
    const s = syncedAt();
    if (!s) return null;
    return dayOf(s) === dayOf(now())
      ? t('Stand: Sync von {t}', { t: hhmm(s) })
      : t('Stand: Sync vom {d}', { d: new Date(s).toLocaleString(loc(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
  };
  // Im Panel nur zeigen, wenn etwas baut
  return (
    <Show when={list().length || props.wide}>
      <section class="ft" classList={{ 'ft-wide': props.wide }}>
        <div class="ft-head">
          <h3>
            <Hammer size={15} /> {t('Foundry')}
            <Show when={ready() > 0}>
              <span class="ft-ready">{t('{n} fertig', { n: ready() })}</span>
            </Show>
          </h3>
          <Show when={stand()}>
            <span class="muted small">{stand()}</span>
          </Show>
        </div>
        <Show when={!list().length}>
          <p class="muted small">{syncedAt() ? t('In der Foundry wird gerade nichts gebaut.') : t('Noch kein Sync – synchronisiere, um laufende Bauaufträge zu sehen.')}</p>
        </Show>
        <ul class="ft-list">
          <For each={list()}>
            {(b) => {
              const done = () => b.completesAt != null && b.completesAt <= now();
              return (
                <li classList={{ done: done() }} title={b.completesAt ? new Date(b.completesAt).toLocaleString(loc()) : ''}>
                  <BuildIcon src={b.image} />
                  <span class="ft-name">{b.name}</span>
                  <span class="ft-time">
                    {done() ? (
                      <>
                        <CircleCheck size={14} /> {t('Fertig')}
                      </>
                    ) : b.completesAt ? (
                      countdown(b.completesAt)
                    ) : (
                      '–'
                    )}
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}

// Was zum Bauen noch fehlt, wenn alle Blaupausen da sind: Status-Text und kleine Material-Symbole
// mit "hast/brauchst" (wie die Crafting Costs im Spiel).
import { For, Show } from 'solid-js';
import { Coins, Hammer } from 'lucide-solid';
import { compact } from '../lib/gamedb.js';
import { t } from '../lib/i18n.js';
import { materialClick } from './MaterialInfo.jsx';

/** Fehlende Rohstoffe, noch zu bauende Bauteile, Credits einer evaluate()-Zeile. */
export function buildNeeds(row) {
  const mats = row.resources.filter((r) => r.built < r.count);
  const toBuild = row.parts.filter((p) => p.built < p.count && p.built + p.bp >= p.count);
  return { mats, toBuild, credits: !row.creditsOk };
}

/** Text für den Status "blueprints": was genau noch fehlt. */
export function blueprintLabel(row) {
  const n = buildNeeds(row);
  if (n.mats.length || n.credits) return t('Blaupause da – Material fehlt');
  if (n.toBuild.length) return t('Bauteile noch bauen');
  return t('Blaupausen da');
}

/** Kleine Symbole: Material-Bild + hast/brauchst, Credits, noch zu bauende Teile. */
export default function BuildNeeds(props) {
  const n = () => buildNeeds(props.row);
  return (
    <Show when={props.row.status === 'blueprints'}>
      <span class="build-needs" onClick={(e) => e.stopPropagation()}>
        <Show when={n().credits}>
          <span class="bn-chip" title={t('Credits: {a} von {b}', { a: compact(props.inv?.player.credits ?? 0), b: compact(props.row.item.credits) })}>
            <Coins size={13} /> {compact(props.row.item.credits)}
          </span>
        </Show>
        <For each={n().mats}>
          {(m) => (
            <span class="bn-chip bn-click" onClick={materialClick(m)} title={`${m.name}: ${m.built.toLocaleString('de-DE')} / ${m.count.toLocaleString('de-DE')} – ${t('Klick: wie farme ich das?')}`}>
              <Show when={m.image} fallback={<b>{m.name.slice(0, 2)}</b>}>
                <img src={m.image} alt="" />
              </Show>
              {compact(m.built)}/{compact(m.count)}
            </span>
          )}
        </For>
        <For each={n().toBuild}>
          {(p) => (
            <span class="bn-chip bn-build" title={t('{x} – Blaupause vorhanden, muss noch gebaut werden', { x: p.name })}>
              <Hammer size={12} /> {p.name.replace(`${props.row.item.name} `, '')}
            </span>
          )}
        </For>
      </span>
    </Show>
  );
}

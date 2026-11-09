import { For, Show } from 'solid-js';
import { Lock, Star, ThumbsUp } from 'lucide-solid';
import { expectedValue } from '../lib/gamedb.js';
import { Plat, Ducat } from './Icons.jsx';
import { RelicIcon } from './WorldWidgets.jsx';
import { t } from '../lib/i18n.js';

export const STATUS = {
  need: { text: 'Fehlt dir', cls: 'need' },
  have: { text: 'Hast du', cls: 'have' },
  owned: { text: 'Item im Besitz', cls: 'owned' },
  mastered: { text: 'Gemeistert', cls: 'mastered' },
  forma: { text: 'Forma', cls: 'none' },
  none: { text: '', cls: 'none' },
};
export const REF_LABEL = { intact: 'Intact', exceptional: 'Exceptional', flawless: 'Flawless', radiant: 'Radiant' };

export const fmt = (v, digits = 0) => (v == null ? '–' : Number(v).toFixed(digits).replace(/\.0+$/, ''));

/** Eine Spalte unter einer Belohnung (wie bei AlecaFrame). */
export function RewardColumn(props) {
  const st = () => STATUS[props.info.status];
  return (
    <div class={`rw-col st-${st().cls}`} classList={{ best: props.best }}>
      <div class="rw-name">{props.info.name}</div>
      <div class="rw-values">
        <span>
          {fmt(props.info.plat)} <Plat />
        </span>
        <Show when={props.info.vaulted}>
          <Lock size={13} class="rw-vault" />
        </Show>
        <span>
          {props.info.ducats} <Ducat />
        </span>
      </div>
      <Show when={props.info.status === 'forma'}>
        <div class="rw-bar" title={t('Forma-Blaupausen im Inventar')}>
          <span>{t('Hast du')}</span>
          <b>{props.info.have}</b>
        </div>
      </Show>
      <Show when={props.info.item}>
        <div class="rw-bar" title={props.info.neededFor ? t('Wird noch für {x} gebraucht', { x: props.info.neededFor }) : t('Hast du / braucht das Set')}>
          <span>{props.info.neededFor ? t('Für {x}', { x: props.info.neededFor }) : t(st().text)}</span>
          <b>
            {props.info.have}/{props.info.need}
          </b>
        </div>
      </Show>
      <Show when={props.info.setParts.length > 0}>
        <div class="rw-set">
          <For each={props.info.setParts}>
            {(p) => (
              <span class="rw-part" classList={{ ok: p.have >= p.count }} title={`${p.name}: ${p.have}/${p.count}`}>
                {p.image ? <img src={p.image} alt="" /> : p.name[0]}
                <i>{p.have}</i>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.info.setPrice != null}>
        <div class="rw-setprice" title={t('Set-Preis')}>
          Set {fmt(props.info.setPrice)} <Plat />
        </div>
      </Show>
      <div class="rw-tags">
        <Show when={props.best}>
          <span class="rw-best">
            <ThumbsUp size={11} /> {t('Nimm das')}
          </span>
        </Show>
        <Show when={props.info.onTodo}>
          <span class="rw-todo">
            <Star size={11} fill="currentColor" /> To-Do
          </span>
        </Show>
      </div>
    </div>
  );
}

/** Panel für den Belohnungs-Bildschirm: alle 4 Teile (deins und die deiner Teammates). */
export function RewardsPanel(props) {
  const infos = () => props.result.items.map((it) => props.ri.info(it.name));
  const best = () => props.ri.pick(infos());
  return (
    <div class="rw-panel">
      <div class="rw-cols">
        <For each={infos()}>{(info) => <RewardColumn info={info} best={info === best()} />}</For>
      </div>
      <div class="rw-footer">
        <span>Cephalon Merlin</span>
        <Show when={props.showWallet && props.ri.player}>
          <span class="rw-wallet">
            {props.ri.player.platinum?.toLocaleString('de-DE')} <Plat /> {props.ri.player.ducats?.toLocaleString('de-DE')} <Ducat />
          </span>
        </Show>
      </div>
    </div>
  );
}

/** Die besten eigenen Relikte einer Ära ("6x Lith A12 Intact"). */
function Recommended(props) {
  const rec = () => props.ri.recommend({ squad: props.squad, tier: props.era, limit: 6 });
  return (
    <>
      <div class="rec-head">
        <span class="rec-count">
          <Show when={props.era}>
            <RelicIcon tier={props.era} size={22} />
          </Show>{' '}
          {rec().total}
        </span>
        <b>{props.era ? t('Beste {era}-Relikte', { era: props.era }) : t('Empfohlene Relikte')}</b>
        <span class="muted small">{t('{n}er-Squad', { n: props.squad })}</span>
      </div>
      <div class="rec-grid">
        <For each={rec().list}>
          {(r) => (
            <div class="rec-card">
              <div class="rec-name">
                <Show when={r.relic.vaulted}>
                  <Lock size={12} class="rw-vault" />
                </Show>
                <span class="muted">{r.count}x</span> {r.relic.name} {REF_LABEL[r.refinement]}
              </div>
              <div class="rec-ev">
                <span class="muted">{t('Gewinn:')}</span>
                <span>
                  {r.plat.toFixed(1)} <Plat />
                </span>
                <span>
                  {r.ducats.toFixed(1)} <Ducat />
                </span>
              </div>
              <Show when={r.needed > 0}>
                <div class="need-count">{t('{n} Teile fehlen dir', { n: r.needed })}</div>
              </Show>
            </div>
          )}
        </For>
        <Show when={rec().list.length === 0}>
          <div class="muted small">{props.era ? t('Keine {era}-Relikte im Inventar.', { era: props.era }) : t('Keine Relikte im Inventar.')}</div>
        </Show>
      </div>
    </>
  );
}

/** Gerade angeklicktes Relikt: alle 6 Teile mit Chance, Wert und ob sie dir fehlen. */
function SelectedRelic(props) {
  const relic = () => props.ri.relicById(props.result.relicId);
  const rewards = () => relic()?.rewards[props.result.refinement] ?? relic()?.rewards.intact ?? [];
  const rows = () =>
    rewards()
      .map((w) => ({ w, info: props.ri.info(w.name) }))
      .sort((a, b) => (b.info.status === 'need') - (a.info.status === 'need') || (b.info.plat ?? 0) - (a.info.plat ?? 0));
  const ev = () => expectedValue(rewards(), (w) => props.ri.priceOf(w.name) ?? 0, props.squad);
  const evDucats = () => expectedValue(rewards(), (w) => props.ri.info(w.name).ducats, props.squad);
  return (
    <Show when={relic()}>
      <div class="sel-selected">
        <div class="sel-head">
          <RelicIcon tier={relic().tier} size={28} />
          <div>
            <b>
              {relic().name} {REF_LABEL[props.result.refinement]}
            </b>
            <div class="sel-ev">
              {t('Gewinn:')} {ev().toFixed(1)} <Plat /> · {evDucats().toFixed(1)} <Ducat />
              <Show when={relic().vaulted}>
                <span class="rw-vault-tag">
                  <Lock size={11} /> Vaulted
                </span>
              </Show>
            </div>
          </div>
        </div>
        <table class="sel-table">
          <tbody>
            <For each={rows()}>
              {({ w, info }) => (
                <tr class={`st-${STATUS[info.status].cls}`}>
                  <td class="sel-name">
                    <Show when={info.onTodo}>
                      <Star size={11} fill="currentColor" class="rw-todo-ico" />
                    </Show>{' '}
                    {w.name}
                  </td>
                  <td class="sel-chance">{w.chance} %</td>
                  <td>
                    {fmt(info.plat)} <Plat />
                  </td>
                  <td>
                    {info.ducats} <Ducat />
                  </td>
                  <td class="sel-status" title={info.neededFor ? t('Wird noch für {x} gebraucht', { x: info.neededFor }) : undefined}>
                    {t(STATUS[info.status].text)}
                    {info.neededFor ? ` ${t('(für {x})', { x: info.neededFor })}` : info.item ? ` ${info.have}/${info.need}` : ''}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}

/** Panel für die Relikt-Auswahl. `compact` (Overlay): ohne Tabelle – Infos stehen als Schilder an den Belohnungen. */
export function SelectionPanel(props) {
  const squad = () => props.squad ?? 4;
  const era = () => props.result.era ?? props.ri.relicById(props.result.relicId)?.tier ?? null;
  return (
    <div class="sel-panel">
      <Recommended era={era()} ri={props.ri} squad={squad()} />
      <Show when={props.result.relicId && !props.compact}>
        <SelectedRelic result={props.result} ri={props.ri} squad={squad()} />
      </Show>
    </div>
  );
}

/** Kleines Schild an einer Belohnung in der Relikt-Auswahl des Spiels. */
export function RewardTag(props) {
  const st = () => STATUS[props.info.status];
  return (
    <div class={`rw-tag st-${st().cls}`}>
      <span>
        {fmt(props.info.plat)} <Plat size={11} />
      </span>
      <span>
        {props.info.ducats} <Ducat size={11} />
      </span>
      <Show when={props.info.item}>
        <b>
          {t(st().text)} {props.info.have}/{props.info.need}
        </b>
      </Show>
      <Show when={props.info.onTodo}>
        <Star size={10} fill="currentColor" class="rw-todo-ico" />
      </Show>
    </div>
  );
}

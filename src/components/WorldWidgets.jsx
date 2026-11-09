// Bausteine für Timer-Panel und Weltstatus-Seite: Zyklen, Baro, Spalten, Sortie/Archon/Nightwave.
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Infinity as All, ChevronUp, ChevronsUp, Rocket, ChevronDown, ChevronRight, Swords, Skull, Radio, Check, Gem } from 'lucide-solid';
import { world, now, countdown, isLive, checks, toggleRound, toggleChallenge, pruneChallenges } from '../lib/world.js';
import { t, num } from '../lib/i18n.js';
import { load, save } from '../lib/ipc.js';

const CYCLES = [
  { key: 'earth', place: 'Erde', planet: 'earth' },
  { key: 'cetus', place: 'Cetus', planet: 'earth' },
  { key: 'vallis', place: 'Vallis', planet: 'venus' },
  { key: 'cambion', place: 'Cambion', planet: 'deimos' },
];
const STATE_DE = { day: 'TAG', night: 'NACHT', warm: 'WARM', cold: 'KALT', fass: 'FASS', vome: 'VOME' };
const TIERS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Omnia'];

// Relikt-Bild pro Stufe (zur Laufzeit von warframestat.us geladen). Omnia: Buchstabe.
const RELIC_IMAGES = { Lith: 'RelicLithD.png', Meso: 'RelicMesoD.png', Neo: 'RelicNeoD.png', Axi: 'RelicAxiD.png', Requiem: 'RelicImmortalD.png' };
export function RelicIcon(props) {
  const size = () => props.size ?? 26;
  return (
    <Show
      when={RELIC_IMAGES[props.tier]}
      fallback={
        <span class={`relic-icon tier-${props.tier.toLowerCase()}`} style={{ width: `${size()}px`, height: `${size()}px` }} title={props.tier}>
          {props.tier[0]}
        </span>
      }
    >
      <img class="relic-img-icon" src={`https://cdn.warframestat.us/img/${RELIC_IMAGES[props.tier]}`} width={size()} height={size()} alt={props.tier} title={props.tier} />
    </Show>
  );
}

export function BaroBadge() {
  return (
    <Show when={world.baro}>
      {(b) => (
        <span class="pill pill-teal">
          {new Date(b().activation).getTime() <= now()
            ? t('Baro geht in {t}', { t: countdown(b().expiry) })
            : t('Baro kommt in {t}', { t: countdown(b().activation) })}
          <Show when={b().location}>
            <span class="muted"> · {b().location}</span>
          </Show>
        </span>
      )}
    </Show>
  );
}

export function Cycles() {
  return (
    <div class="cycles">
      <For each={CYCLES}>
        {({ key, place, planet }) => (
          <div class="cycle">
            <span class={`planet planet-${planet}`} />
            <div>
              <div class="cycle-state">
                <small>{t(place).toUpperCase()}</small> <b>{world[key] ? t(STATE_DE[world[key].state] ?? world[key].state.toUpperCase()) : '…'}</b>
              </div>
              <div class="cycle-time">{world[key] ? countdown(world[key].expiry) : '–'}</div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

const MODES = [
  { id: 'all', icon: All, title: 'Alle' },
  { id: 'normal', icon: ChevronUp, title: 'Normal' },
  { id: 'hard', icon: ChevronsUp, title: 'Steel Path' },
  { id: 'storm', icon: Rocket, title: 'Void-Sturm (Railjack)' },
];

export function Fissures() {
  const [mode, setMode] = createSignal(load('cm.fissures.mode', 'normal'));
  const pick = (m) => {
    setMode(m);
    save('cm.fissures.mode', m);
  };
  const byTier = createMemo(() => {
    const m = mode();
    const at = now();
    const list = (world.fissures ?? [])
      .filter((f) => new Date(f.expiry).getTime() > at)
      .filter((f) => (m === 'all' ? true : m === 'hard' ? f.isHard : m === 'storm' ? f.isStorm : !f.isHard && !f.isStorm))
      .sort((a, b) => a.tierNum - b.tierNum || new Date(a.expiry) - new Date(b.expiry));
    return TIERS.map((tier) => [tier, list.filter((f) => f.tier === tier)]).filter(([, l]) => l.length);
  });
  return (
    <section class="fissures">
      <div class="fissures-head">
        <h3>{t('Void-Spalten')}</h3>
        <div class="seg">
          <For each={MODES}>
            {(md) => (
              <button classList={{ active: mode() === md.id }} onClick={() => pick(md.id)} title={t(md.title)}>
                <Dynamic component={md.icon} size={15} />
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={byTier().length > 0} fallback={<p class="muted small">{t('Keine Spalten in dieser Ansicht.')}</p>}>
        <For each={byTier()}>
          {([tier, items]) => (
            <div class="fissure-tier">
              <RelicIcon tier={tier} size={30} />
              <ul>
                <For each={items}>
                  {(f) => (
                    <li>
                      <span class="fissure-mission">
                        <Show when={f.isHard}>
                          <ChevronsUp size={12} class="sp" />
                        </Show>
                        <b>{f.missionType}</b> <span class="muted">({f.node})</span>
                      </span>
                      <span class="fissure-time">{countdown(f.expiry)}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </Show>
    </section>
  );
}

// ---------- Aufgaben: Sortie, Archon-Jagd, Nightwave ----------
const OPEN_KEY = 'cm.worldtasks.open';
const SHARD = { crimson: 'Karmesin-Scherbe', amber: 'Bernstein-Scherbe', azure: 'Azur-Scherbe' };
const KINDS = [
  ['daily', 'Täglich'],
  ['weekly', 'Wöchentlich'],
  ['elite', 'Elite wöchentlich'],
];

function DoneBox(props) {
  return (
    <button class="wt-check" classList={{ on: props.done }} onClick={props.onClick} title={props.title} aria-pressed={props.done}>
      <Show when={props.done}>
        <Check size={13} />
      </Show>
    </button>
  );
}

function Section(props) {
  return (
    <section class="wt-section" classList={{ 'wt-done': props.done }}>
      <div class="wt-head">
        <button class="wt-toggle" onClick={() => props.onToggle(props.id)}>
          {props.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <Dynamic component={props.icon} size={15} />
          <h3>{props.title}</h3>
        </button>
        {props.extra}
      </div>
      <Show when={props.open}>
        <div class="wt-body">{props.children}</div>
      </Show>
    </section>
  );
}

function Round(props) {
  const isSortie = props.kind === 'sortie';
  const done = () => checks[props.kind] === props.round.id;
  return (
    <Section
      id={props.kind}
      icon={isSortie ? Swords : Skull}
      title={t(isSortie ? 'Sortie' : 'Archon-Jagd')}
      open={props.open}
      onToggle={props.onToggle}
      done={done()}
      extra={
        <div class="wt-extra">
          <span class="wt-time">{countdown(props.round.expiry)}</span>
          <DoneBox done={done()} onClick={() => toggleRound(props.kind, props.round.id)} title={t(isSortie ? 'Heute erledigt' : 'Diese Woche erledigt')} />
        </div>
      }
    >
      <div class="wt-boss">
        <b>{props.round.boss}</b>
        <Show when={props.round.faction}>
          <span class="muted"> · {props.round.faction}</span>
        </Show>
        <Show when={props.round.shard}>
          <span class={`wt-shard wt-shard-${props.round.shard}`}>
            <Gem size={12} /> {t(SHARD[props.round.shard])}
          </span>
        </Show>
      </div>
      <ol class="wt-missions">
        <For each={props.round.missions}>
          {(m) => (
            <li>
              <div>
                <b>{m.missionType}</b> <span class="muted">({m.node})</span>
              </div>
              <Show when={m.modifier}>
                <div class="wt-mod" title={m.modifierDesc}>
                  {m.modifier}
                </div>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </Section>
  );
}

function Nightwave(props) {
  const ids = () => props.nw.challenges.map((c) => c.id);
  createEffect(() => pruneChallenges(ids()));
  const done = () => new Set(checks.nw);
  const doneCount = () => ids().filter((id) => done().has(id)).length;
  const standing = () => props.nw.challenges.reduce((s, c) => s + (done().has(c.id) ? c.standing : 0), 0);
  const total = () => props.nw.challenges.reduce((s, c) => s + c.standing, 0);
  return (
    <Section
      id="nightwave"
      icon={Radio}
      title={t('Nightwave')}
      open={props.open}
      onToggle={props.onToggle}
      done={ids().length > 0 && doneCount() === ids().length}
      extra={
        <div class="wt-extra">
          <span class="wt-count">{t('{n}/{m} erledigt', { n: doneCount(), m: ids().length })}</span>
          <span class="wt-time">{countdown(props.nw.expiry)}</span>
        </div>
      }
    >
      <div class="wt-standing muted small">{t('Ansehen: {n} / {m}', { n: num(standing()), m: num(total()) })}</div>
      <For each={KINDS}>
        {([kind, label]) => (
          <Show when={props.nw.challenges.some((c) => c.kind === kind)}>
            <div class="wt-group">
              <h4>{t(label)}</h4>
              <ul>
                <For each={props.nw.challenges.filter((c) => c.kind === kind)}>
                  {(c) => (
                    <li classList={{ 'wt-done': done().has(c.id) }}>
                      <DoneBox
                        done={done().has(c.id)}
                        onClick={() => toggleChallenge(c.id, ids())}
                        title={t(done().has(c.id) ? 'Als offen markieren' : 'Als erledigt markieren')}
                      />
                      <div class="wt-chal">
                        <b>{c.title}</b>
                        <Show when={c.desc}>
                          <div class="muted">{c.desc}</div>
                        </Show>
                      </div>
                      <div class="wt-chal-side">
                        <span class="wt-rep">+{num(c.standing)}</span>
                        <span class="wt-time muted">{countdown(c.expiry)}</span>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        )}
      </For>
    </Section>
  );
}

export function WorldTasks() {
  const [open, setOpen] = createSignal(load(OPEN_KEY, { sortie: true, archon: true, nightwave: true }));
  const toggle = (id) => {
    const next = { ...open(), [id]: !open()[id] };
    setOpen(next);
    save(OPEN_KEY, next);
  };
  return (
    <Show when={world.time} fallback={<p class="muted small">{t('Lade Weltstatus …')}</p>}>
      <div class="wt">
        <Show when={isLive(world.sortie)}>
          <Round kind="sortie" round={world.sortie} open={!!open().sortie} onToggle={toggle} />
        </Show>
        <Show when={isLive(world.archon)}>
          <Round kind="archon" round={world.archon} open={!!open().archon} onToggle={toggle} />
        </Show>
        <Show when={isLive(world.nightwave)}>
          <Nightwave nw={world.nightwave} open={!!open().nightwave} onToggle={toggle} />
        </Show>
        <Show when={!isLive(world.sortie) && !isLive(world.archon) && !isLive(world.nightwave)}>
          <p class="muted small">{t('Gerade keine Sortie, Archon-Jagd oder Nightwave.')}</p>
        </Show>
      </div>
    </Show>
  );
}

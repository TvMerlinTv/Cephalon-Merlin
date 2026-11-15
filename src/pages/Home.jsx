// Startseite „Heute": was gerade zählt – Welt, Foundry, offene Runden, fast fertige Sets, Handel.
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { Bell, Check, ChevronRight, Coins, Flame, Gem, HandCoins, ListChecks, Plus, RotateCcw, Skull, Store, Swords, Timer, X } from 'lucide-solid';
import { BaroBadge, Cycles } from '../components/WorldWidgets.jsx';
import FoundryTimers from '../components/FoundryTimers.jsx';
import { Plat, Ducat } from '../components/Icons.jsx';
import { world, checks, countdown, isLive, toggleRound } from '../lib/world.js';
import { game, syncGame } from '../lib/game.js';
import { loadMasteryDb, loadBulkPrices, loadRelicDb, compact } from '../lib/gamedb.js';
import { getItems } from '../lib/market.js';
import { spareParts } from '../lib/trade.js';
import { nearlyComplete, farmPlan } from '../lib/today.js';
import { now } from '../lib/world.js';
import { checklist, isDone, nextReset, toggleTask, addTask, removeTask, resetTasks } from '../lib/checklist.js';
import { baroOffer } from '../lib/baro.js';
import { alerts } from '../lib/priceAlerts.js';
import { settings, isFounders } from '../lib/settings.js';
import { t, num } from '../lib/i18n.js';
import './home.css';

function RoundRow(props) {
  const done = () => checks[props.kind] === props.round.id;
  return (
    <li classList={{ done: done() }}>
      <button class="wt-check" classList={{ on: done() }} onClick={() => toggleRound(props.kind, props.round.id)} aria-pressed={done()} title={t(done() ? 'Erledigt' : 'Als erledigt markieren')}>
        <Show when={done()}>
          <Check size={13} />
        </Show>
      </button>
      {props.kind === 'sortie' ? <Swords size={15} /> : <Skull size={15} />}
      <span class="hm-grow">
        <b>{t(props.kind === 'sortie' ? 'Sortie' : 'Archon-Jagd')}</b> <span class="muted">· {props.round.boss}</span>
      </span>
      <span class="hm-time">{countdown(props.round.expiry)}</span>
    </li>
  );
}

// Eigene Aufgaben zum Abhaken; die Haken verfallen täglich bzw. wöchentlich von selbst
function Checklist() {
  const [text, setText] = createSignal('');
  const [kind, setKind] = createSignal('daily');
  const group = (k) => checklist.tasks.filter((x) => x.kind === k);
  const open = (k) => group(k).filter((x) => !isDone(checklist, x, now())).length;
  const submit = (e) => {
    e.preventDefault();
    if (addTask(kind(), text())) setText('');
  };
  return (
    <section class="help-card">
      <h3>
        <ListChecks size={15} /> {t('Checkliste')}
        <button class="link-btn hm-more" onClick={resetTasks} title={t('Eigene Aufgaben entfernen und die Vorschläge wiederherstellen')}>
          <RotateCcw size={13} /> {t('Zurücksetzen')}
        </button>
      </h3>
      <For each={['daily', 'weekly']}>
        {(k) => (
          <Show when={group(k).length}>
            <div class="hm-check-head">
              <b>{t(k === 'daily' ? 'Täglich' : 'Wöchentlich')}</b>
              <span class="muted small">
                {open(k) ? t('{n} offen', { n: open(k) }) : t('alles erledigt')} · {t('neu in {t}', { t: countdown(nextReset(k, now())) })}
              </span>
            </div>
            <ul class="hm-list hm-checks">
              <For each={group(k)}>
                {(task) => {
                  const done = () => isDone(checklist, task, now());
                  return (
                    <li classList={{ done: done() }}>
                      <button class="wt-check" classList={{ on: done() }} onClick={() => toggleTask(task)} aria-pressed={done()} aria-label={task.own ? task.text : t(task.text)}>
                        <Show when={done()}>
                          <Check size={13} />
                        </Show>
                      </button>
                      <span class="hm-grow">{task.own ? task.text : t(task.text)}</span>
                      <button class="icon-btn hm-del" onClick={() => removeTask(task.id)} aria-label={t('Aufgabe entfernen')} title={t('Aufgabe entfernen')}>
                        <X size={14} />
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        )}
      </For>
      <form class="hm-add" onSubmit={submit}>
        <input value={text()} onInput={(e) => setText(e.currentTarget.value)} maxLength={80} placeholder={t('Eigene Aufgabe …')} aria-label={t('Eigene Aufgabe …')} />
        <select value={kind()} onChange={(e) => setKind(e.currentTarget.value)} aria-label={t('Zeitraum')}>
          <option value="daily">{t('Täglich')}</option>
          <option value="weekly">{t('Wöchentlich')}</option>
        </select>
        <button class="btn" type="submit" disabled={!text().trim()}>
          <Plus size={14} /> {t('Hinzufügen')}
        </button>
      </form>
    </section>
  );
}

export default function Home(props) {
  const [db] = createResource(() => loadMasteryDb().catch(() => null));
  const [bulk] = createResource(() => loadBulkPrices().catch(() => ({})));
  const [market] = createResource(() => getItems().then((items) => new Map(items.filter((i) => i.gameRef).map((i) => [i.gameRef, i]))).catch(() => null));

  const sets = createMemo(() => nearlyComplete(db(), game.inventory, { skip: (i) => settings.hideFounders && isFounders(i) }));
  const spare = createMemo(() => {
    if (!db() || !game.inventory) return null;
    const b = bulk() ?? {};
    let count = 0;
    let ducats = 0;
    let plat = 0;
    for (const e of spareParts(db(), game.inventory)) {
      const m = market()?.get(e.id) ?? market()?.get(e.id.replace(/Component$/, 'Blueprint'));
      const name = m?.name ?? `${e.items[0].name} ${e.part.name}`;
      count += e.spare;
      ducats += e.ducats * e.spare;
      plat += (b[name.toLowerCase()] ?? 0) * e.spare;
    }
    return { count, ducats, plat: Math.round(plat) };
  });
  // Farm-Plan: welche eigenen Relikte die fehlenden Teile droppen und ob gerade eine Spalte der Ära läuft
  const [relicDb] = createResource(() => loadRelicDb().catch(() => null));
  const activeTiers = createMemo(() => {
    const at = now();
    return new Set((world.fissures ?? []).filter((f) => !f.isStorm && new Date(f.expiry).getTime() > at).map((f) => f.tier));
  });
  const plan = createMemo(() => farmPlan(sets(), relicDb()?.relics, game.inventory?.relics, activeTiers()));
  // Was es kostet, die fehlenden Teile eines Sets einfach zu kaufen (Sammelpreise)
  const buyPrice = (s) => {
    const b = bulk() ?? {};
    let sum = 0;
    for (const m of s.missing) {
      const mi = market()?.get(m.id) ?? market()?.get(m.id.replace(/Component$/, 'Blueprint'));
      const p = b[(mi?.name ?? `${s.item.name} ${m.name}`).toLowerCase()];
      if (!p) return null;
      sum += p * m.lack;
    }
    return Math.round(sum);
  };
  // Baros Angebot, solange er da ist
  const baroHere = () => world.baro && new Date(world.baro.activation).getTime() <= now() && new Date(world.baro.expiry).getTime() > now();
  const offer = createMemo(() => (baroHere() ? baroOffer(world.baro.items, market(), db()?.index, game.inventory) : []));
  const [allOffers, setAllOffers] = createSignal(false);
  const activeAlerts = () => alerts().filter((a) => a.enabled !== false).length;
  const hasRounds = () => isLive(world.sortie) || isLive(world.archon);

  return (
    <div class="page home">
      <div class="hm-head">
        <h2>{game.inventory?.player?.name ? t('Willkommen zurück, {name}', { name: game.inventory.player.name }) : t('Willkommen, Tenno')}</h2>
        <BaroBadge />
      </div>
      <Show when={!game.inventory}>
        <div class="notice hm-notice">
          {t('Noch kein Inventar – synchronisiere zuerst mit dem Spiel.')}{' '}
          <button class="btn btn-primary" onClick={syncGame} disabled={game.syncing}>
            {t('Mit Spiel synchronisieren')}
          </button>
        </div>
      </Show>

      <div class="hm-grid">
        <section class="help-card">
          <h3>
            <Timer size={15} /> {t('Welt')}
            <button class="link-btn hm-more" onClick={() => props.onNavigate('world')}>
              {t('Weltstatus')} <ChevronRight size={14} />
            </button>
          </h3>
          <Show when={world.time} fallback={<p class="muted small">{t('Lade Weltstatus …')}</p>}>
            <Cycles />
            <Show when={hasRounds()}>
              <ul class="hm-list hm-rounds">
                <Show when={isLive(world.sortie)}>
                  <RoundRow kind="sortie" round={world.sortie} />
                </Show>
                <Show when={isLive(world.archon)}>
                  <RoundRow kind="archon" round={world.archon} />
                </Show>
              </ul>
            </Show>
          </Show>
        </section>

        <section class="help-card hm-foundry">
          <FoundryTimers wide />
        </section>

        <section class="help-card">
          <h3>
            <Gem size={15} /> {t('Fast vollständige Prime-Sets')}
            <button class="link-btn hm-more" onClick={() => props.onNavigate('mastery')}>
              {t('Mastery-Helfer')} <ChevronRight size={14} />
            </button>
          </h3>
          <Show when={sets().length} fallback={<p class="muted small">{game.inventory ? t('Gerade fehlt bei keinem angefangenen Prime-Set nur noch ein oder zwei Teile.') : t('Erscheint nach dem ersten Sync.')}</p>}>
            <ul class="hm-list">
              <For each={sets()}>
                {(s) => (
                  <li>
                    <button class="hm-set" onClick={() => props.onItem({ item: s.item, partId: s.missing[0].id })} title={t('Details und Fundorte öffnen')}>
                      <Show when={s.item.image}>
                        <img src={s.item.image} alt="" loading="lazy" />
                      </Show>
                      <span class="hm-grow">
                        <b>{s.item.name}</b>
                        <small class="muted">
                          {t('Fehlt:')} {s.missing.map((m) => (m.lack > 1 ? `${m.lack}× ${m.name}` : m.name)).join(', ')}
                        </small>
                      </span>
                      <Show when={buyPrice(s) != null}>
                        <span class="hm-buy" title={t('So viel kosten die fehlenden Teile ungefähr auf warframe.market')}>
                          ≈ {buyPrice(s)} <Plat size={12} />
                        </span>
                      </Show>
                      <span class="hm-progress" title={t('Teile vorhanden')}>
                        {s.have}/{s.total}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="help-card">
          <h3>
            <Flame size={15} /> {t('Farm-Plan')}
            <button class="link-btn hm-more" onClick={() => props.onNavigate('relics')}>
              {t('Relikt-Planer')} <ChevronRight size={14} />
            </button>
          </h3>
          <Show when={plan().length} fallback={<p class="muted small">{game.inventory ? t('Kein fehlendes Teil eines fast fertigen Sets gefunden.') : t('Erscheint nach dem ersten Sync.')}</p>}>
            <ul class="hm-list">
              <For each={plan()}>
                {(p) => (
                  <li class="hm-plan" classList={{ now: p.active }}>
                    <button class="hm-plan-name" onClick={() => props.onItem({ item: p.item, partId: p.part.id })} title={t('Details und Fundorte öffnen')}>
                      {p.item.name} · {p.part.name}
                    </button>
                    <Show
                      when={p.relics.length}
                      fallback={
                        <small class="muted">
                          {p.sources.length ? t('Kein passendes Relikt im Besitz – droppt aus: {r}', { r: p.sources.join(', ') }) : t('Kein passendes Relikt im Besitz – nur noch in Vault-Relikten.')}
                        </small>
                      }
                    >
                      <span class="hm-relics">
                        <For each={p.relics}>
                          {(r) => (
                            <span class="hm-relic" classList={{ active: r.active }} title={r.active ? t('Für diese Ära läuft gerade eine Spalte') : t('Gerade keine Spalte für diese Ära')}>
                              {r.name} <small>×{r.owned} · {r.chance} %</small>
                            </span>
                          )}
                        </For>
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <p class="muted small hm-legend">{t('Golden markiert: Für diese Ära läuft gerade eine Spalte.')}</p>
          </Show>
        </section>

        <Checklist />

        <Show when={offer().length}>
          <section class="help-card">
            <h3>
              <Store size={15} /> {t('Baros Angebot')}
              <span class="muted small hm-more">
                {t('{a} von {b} kannst du dir leisten', { a: offer().filter((o) => o.affordable).length, b: offer().length })}
              </span>
            </h3>
            <ul class="hm-list hm-offer">
              <For each={allOffers() ? offer() : offer().slice(0, 8)}>
                {(o) => (
                  <li classList={{ owned: o.owned > 0, cant: o.affordable === false }}>
                    <Show when={o.image} fallback={<span class="hm-noimg" />}>
                      <img src={o.image} alt="" loading="lazy" />
                    </Show>
                    <span class="hm-grow" classList={{ muted: !o.known }} title={o.known ? undefined : t('Kein Anzeigename bekannt – interner Name aus dem Spiel')}>
                      {o.name}
                      <Show when={o.owned > 0}>
                        <small class="hm-have">
                          <Check size={11} /> {t('hast du')}
                        </small>
                      </Show>
                    </span>
                    <span class="hm-cost">
                      {num(o.ducats)} <Ducat size={12} />
                    </span>
                    <span class="hm-cost muted">{compact(o.credits)} Cr</span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={offer().length > 8}>
              <button class="link-btn hm-all" onClick={() => setAllOffers(!allOffers())}>
                {allOffers() ? t('Weniger zeigen') : t('Alle {n} zeigen', { n: offer().length })}
              </button>
            </Show>
          </section>
        </Show>

        <section class="help-card">
          <h3>
            <HandCoins size={15} /> {t('Handel')}
            <button class="link-btn hm-more" onClick={() => props.onNavigate('trade')}>
              {t('Handel')} <ChevronRight size={14} />
            </button>
          </h3>
          <Show when={spare()} fallback={<p class="muted small">{t('Erscheint nach dem ersten Sync.')}</p>}>
            <div class="hm-stats">
              <div>
                <small class="muted">{t('Übrige Prime-Teile')}</small>
                <b>{num(spare().count)}</b>
              </div>
              <div>
                <small class="muted">{t('Wert bei Baro')}</small>
                <b>
                  {num(spare().ducats)} <Ducat />
                </b>
              </div>
              <div>
                <small class="muted">{t('Marktwert')}</small>
                <b>
                  {num(spare().plat)} <Plat />
                </b>
              </div>
            </div>
          </Show>
          <p class="hm-line">
            <Bell size={14} /> {activeAlerts() ? t('{n} Preis-Alarme aktiv', { n: activeAlerts() }) : t('Keine Preis-Alarme aktiv')}
          </p>
          <Show when={game.inventory?.player}>
            <p class="hm-line">
              <Coins size={14} /> {t('Konto:')} {num(game.inventory.player.platinum)} <Plat /> · {num(game.inventory.player.ducats)} <Ducat />
            </p>
          </Show>
        </section>
      </div>
    </div>
  );
}

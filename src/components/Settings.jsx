// Einstellungs-Fenster: Reiter oben, darunter Haken-Listen. Jede Einstellung hier wirkt wirklich.
// Weitere Reiter (Overlays, Benachrichtigungen, Discord) kommen mit den jeweiligen Funktionen.
import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { X, Check as CheckIcon, RotateCcw, FolderOpen, DatabaseBackup, BellRing, Gamepad2, RefreshCw, ExternalLink, Webhook, Trash2, Send } from 'lucide-solid';
import { settings, setSettings, HOTKEYS, keyLabel } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { call, isTauri, on, openExternal } from '../lib/ipc.js';
import { THEMES, COLOR_KEYS, resolveColors, createDraft } from '../lib/theme.js';
import { UpdateCheck } from './UpdateNotice.jsx';

function Check(props) {
  return (
    <label class="set-row">
      <input type="checkbox" checked={!!settings[props.k]} onChange={(e) => setSettings({ [props.k]: e.currentTarget.checked })} />
      <span>
        {t(props.label)}
        <Show when={props.hint}>
          <small>{t(props.hint)}</small>
        </Show>
      </span>
    </label>
  );
}

// Datenordner und Übernahme aus der Electron-Version
function DataSection() {
  const [info, { refetch }] = createResource(() => (isTauri ? call('app_info') : null));
  const [msg, setMsg] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const again = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call('migrate_again');
      setMsg({ ok: true, text: t('{n} Dateien übernommen. Die bisherigen liegen im Ordner „backup“.', { n: r.copied.length }) });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h4>{t('Daten')}</h4>
      <Show when={info()} fallback={<p class="muted small">{t('Nur in der Desktop-App.')}</p>}>
        <p class="muted small">
          {t('Datenordner')}: <code>{info().dataDir}</code>
        </p>
        <Show
          when={info().legacyDir}
          fallback={<p class="muted small">{t('Keine Daten der bisherigen Version (Electron) gefunden.')}</p>}
        >
          <p class="muted small">
            {t('Bisherige Version (Electron)')}: <code>{info().legacyDir}</code>
            <Show when={info().migration?.at}>
              {' '}
              · {t('übernommen am {d}', { d: new Date(info().migration.at).toLocaleString(settings.language === 'en' ? 'en-GB' : 'de-DE') })}
            </Show>
          </p>
          <div class="set-line">
            <button class="btn" disabled={busy()} onClick={again} title={t('Inventar, To-Do-Liste, Statistiken, Builds, Alarme und Einstellungen erneut kopieren')}>
              <DatabaseBackup size={14} /> {t('Daten der bisherigen Version erneut übernehmen')}
            </button>
            <button class="btn" onClick={() => call('open_data_dir')}>
              <FolderOpen size={14} /> {t('Datenordner öffnen')}
            </button>
          </div>
        </Show>
        <Show when={msg()}>
          <p class={`dc-msg ${msg().ok ? 'ok' : 'err'}`}>{msg().text}</p>
        </Show>
      </Show>
    </>
  );
}

// Auto-Sync: läuft im Rust-Teil (autosync.rs), nur solange Warframe läuft und du eingeloggt bist
const AUTO_SYNC_MINUTES = [0, 5, 10, 15, 30, 60, 120];
function AutoSync() {
  return (
    <>
      <h4>{t('Spiel-Sync')}</h4>
      <Check
        k="autoSync"
        label="Automatisch synchronisieren"
        hint="Nur solange Warframe läuft und du eingeloggt bist. Jeder Sync durchsucht kurz den Spielspeicher und erzeugt etwas Last."
      />
      <div class="set-section" classList={{ off: !settings.autoSync }}>
        <label class="set-row">
          <input
            type="checkbox"
            checked={!!settings.autoSyncMission}
            disabled={!settings.autoSync}
            onChange={(e) => setSettings({ autoSyncMission: e.currentTarget.checked })}
          />
          <span>
            {t('Nach jeder Mission')}
            <small>{t('Wenige Sekunden nach der Rückkehr ins Schiff bzw. in den Hub (erkannt über EE.log).')}</small>
          </span>
        </label>
        <div class="set-line">
          <span>{t('Zusätzlich regelmäßig')}</span>
          <select
            value={settings.autoSyncMinutes}
            disabled={!settings.autoSync}
            onChange={(e) => setSettings({ autoSyncMinutes: Number(e.currentTarget.value) })}
          >
            <For each={AUTO_SYNC_MINUTES}>{(m) => <option value={m}>{m ? t('alle {n} Minuten', { n: m }) : t('aus')}</option>}</For>
          </select>
        </div>
      </div>
    </>
  );
}

function General() {
  return (
    <>
      <div class="set-line">
        <span>{t('Sprache')}</span>
        <select value={settings.language} onChange={(e) => setSettings({ language: e.currentTarget.value })}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>
      <Check k="confirmClose" label="Nachfragen, bevor das Hauptfenster geschlossen wird" />
      <Check
        k="hideFounders"
        label="Founders-Items ausblenden (Excalibur Prime, Skana Prime und Lato Prime)"
        hint="Gibt es nicht mehr – zählen dann auch im Mastery-Helfer nicht als fehlend."
      />
      <Check k="secondMonitor" label="Cephalon Merlin beim Start auf den zweiten Monitor verschieben" />
      <AutoSync />
      <DataSection />
      <h4>{t('Updates')}</h4>
      <UpdateCheck />
    </>
  );
}

const QUICK_ACCENTS = ['#6c4ce0', '#2f7de1', '#14b8c4', '#22a06b', '#9ccc3a', '#c9a24a', '#e0603a', '#d6336c', '#c04ee0', '#8d96ad'];

function Appearance() {
  const [s, change] = createDraft();
  const colors = () => resolveColors(s());
  const own = () => s().colors ?? {};
  const groups = [...new Set(COLOR_KEYS.map((c) => c.group))];
  const setColor = (key, value) => {
    const next = { ...own() };
    if (value) next[key] = value;
    else delete next[key];
    change(key === 'accent' ? { colors: next, accent: '' } : { colors: next });
  };
  const customized = () => Object.keys(own()).length > 0 || !!s().accent;

  return (
    <>
      <h4>{t('Theme')}</h4>
      <div class="theme-grid">
        <For each={THEMES}>
          {(th) => (
            <button
              class="theme-swatch"
              classList={{ active: s().theme === th.id }}
              onClick={() => setSettings({ theme: th.id, accent: '', colors: {} })}
              style={{ background: th.colors.bg, 'border-color': s().theme === th.id ? th.colors.accent : th.colors.line }}
            >
              <span class="theme-preview">
                <i style={{ background: th.colors.panel }} />
                <i style={{ background: th.colors.card }} />
                <i style={{ background: th.colors.accent }} />
              </span>
              <span class="theme-name">{t(th.label)}</span>
              <Show when={s().theme === th.id}>
                <CheckIcon size={14} class="theme-check" style={{ color: th.colors.accent }} />
              </Show>
            </button>
          )}
        </For>
      </div>

      <h4>{t('Akzentfarbe')}</h4>
      <div class="theme-accents">
        <For each={QUICK_ACCENTS}>
          {(c) => (
            <button
              class="theme-dot"
              classList={{ active: colors().accent.toLowerCase() === c }}
              style={{ background: c }}
              onClick={() => setColor('accent', c)}
              title={c}
            />
          )}
        </For>
      </div>

      <div class="set-head">
        <h4>{t('Eigene Farben')}</h4>
        <Show when={customized()}>
          <button class="btn" onClick={() => setSettings({ accent: '', colors: {} })} title={t('Alle Farben auf das Theme zurücksetzen')}>
            <RotateCcw size={14} /> {t('Alle zurücksetzen')}
          </button>
        </Show>
      </div>
      <div class="color-groups">
        <For each={groups}>
          {(g) => (
            <div class="color-group">
              <small>{t(g)}</small>
              <For each={COLOR_KEYS.filter((c) => c.group === g)}>
                {(c) => (
                  <label class="color-row">
                    <input type="color" class="set-color" value={colors()[c.key]} onInput={(e) => setColor(c.key, e.currentTarget.value)} />
                    <span>{t(c.label)}</span>
                    <Show when={own()[c.key] || (c.key === 'accent' && s().accent)} fallback={<code>{colors()[c.key]}</code>}>
                      <button
                        class="icon-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          setColor(c.key, '');
                        }}
                        title={t('Farbe des Themes verwenden')}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </Show>
                  </label>
                )}
              </For>
            </div>
          )}
        </For>
      </div>

      <h4>{t('Form & Größe')}</h4>
      <div class="set-line">
        <span>{t('Eckenrundung')}</span>
        <input type="range" min="0" max="20" step="1" value={s().radius} onInput={(e) => change({ radius: Number(e.currentTarget.value) })} />
        <b>{s().radius} px</b>
      </div>
      <div class="set-line">
        <span>{t('Größe der Oberfläche')}</span>
        <input type="range" min="0.01" max="2" step="0.01" value={s().uiScale} onInput={(e) => change({ uiScale: Number(e.currentTarget.value) })} />
        <b>{Math.round(s().uiScale * 100)} %</b>
      </div>
    </>
  );
}

const CYCLES = [
  ['earth', 'Erde (Tag/Nacht)'],
  ['cetus', 'Cetus (Tag/Nacht – Eidolons)'],
  ['vallis', 'Orb Vallis (Warm/Kalt)'],
  ['cambion', 'Cambion Drift (Fass/Vome)'],
];

// Benachrichtigungen schickt der Rust-Teil (src-tauri/src/notify.rs) – auch bei eingeklapptem Panel.
// Foundry, Preis-Alarme und Baro-Ducats kommen mit den jeweiligen Funktionen dazu.
function Notifications() {
  const [tested, setTested] = createSignal(false);
  const box = (k, label) => (
    <label class="set-row">
      <input type="checkbox" checked={!!settings[k]} disabled={!settings.notify} onChange={(e) => setSettings({ [k]: e.currentTarget.checked })} />
      <span>{t(label)}</span>
    </label>
  );
  return (
    <>
      <Check k="notify" label="Benachrichtigungen über Windows senden" />
      <div class="set-section" classList={{ off: !settings.notify }}>
        <h4>{t('Zyklus-Wechsel')}</h4>
        <For each={CYCLES}>
          {([key, label]) => (
            <label class="set-row">
              <input
                type="checkbox"
                checked={!!settings.notifyCycles?.[key]}
                disabled={!settings.notify}
                onChange={(e) => setSettings({ notifyCycles: { ...settings.notifyCycles, [key]: e.currentTarget.checked } })}
              />
              <span>{t(label)}</span>
            </label>
          )}
        </For>
        <div class="set-line">
          <span>{t('Minuten vor dem Wechsel benachrichtigen')}</span>
          <input
            type="number"
            min="0"
            max="30"
            value={settings.notifyMinutes}
            disabled={!settings.notify}
            onChange={(e) => setSettings({ notifyMinutes: Number(e.currentTarget.value) || 0 })}
          />
        </div>
        <h4>{t('Händler')}</h4>
        {box('notifyBaro', "Baro Ki'Teer ist angekommen")}
        {box('notifyBaroDucats', '3 Stunden vor Baros Ankunft: Ducats zum Opfern')}
        <h4>{t('Sortie & Archon-Jagd')}</h4>
        {box('notifySortie', 'Neue Sortie ist da')}
        {box('notifyArchon', 'Neue Archon-Jagd ist da')}
        <h4>{t('Foundry')}</h4>
        {box('notifyFoundry', 'Foundry fertig')}
        <h4>{t('Preis-Alarme')}</h4>
        {box('notifyPriceAlerts', 'Preis-Alarme')}
        <div class="set-line">
          <span>{t('Preise prüfen alle')}</span>
          <select value={settings.priceAlertMinutes} disabled={!settings.notify || !settings.notifyPriceAlerts} onChange={(e) => setSettings({ priceAlertMinutes: Number(e.currentTarget.value) })}>
            <For each={[5, 10, 15, 30]}>{(m) => <option value={m}>{t('{n} Minuten', { n: m })}</option>}</For>
          </select>
        </div>
        <button
          class="btn set-test"
          disabled={!settings.notify || !isTauri}
          onClick={() => call('notify_test').then(() => setTested(true))}
        >
          <BellRing size={14} /> {t(tested() ? 'Gesendet – siehst du sie unten rechts?' : 'Test-Benachrichtigung senden')}
        </button>
      </div>
    </>
  );
}

// Overlay und Texterkennung laufen im Rust-Teil (src-tauri/src/overlay.rs)
function Overlays() {
  return (
    <>
      <Check k="rewardsOverlay" label="Belohnungs-Overlay nach einer Spalten-Mission" />
      <Check k="selectionOverlay" label="Empfehlungen und Zahlen in der Relikt-Auswahl" />
      <Check k="walletOnOverlay" label="Platin und Ducats des Kontos im Belohnungs-Overlay" />
      <Check
        k="copyRewards"
        label="Belohnungs-Infos in die Zwischenablage kopieren"
        hint="Zum Einfügen in den Squad-Chat: Name, Platin und Ducats der 4 Belohnungen."
      />
      <div class="set-line">
        <span>{t('Größe des Belohnungs-Overlays')}</span>
        <input
          type="range"
          min="0.6"
          max="2"
          step="0.05"
          value={settings.rewardsScale}
          onChange={(e) => setSettings({ rewardsScale: Number(e.currentTarget.value) })}
        />
        <b>{Math.round(settings.rewardsScale * 100)} %</b>
      </div>
      <div class="set-line">
        <span>{t('Taste für „Jetzt scannen“')}</span>
        <select value={settings.hotkey} onChange={(e) => setSettings({ hotkey: e.currentTarget.value })}>
          <For each={HOTKEYS}>{(k) => <option value={k}>{keyLabel(k, settings.language)}</option>}</For>
        </select>
      </div>
      <p class="muted small">
        {t('Das Overlay ist nur im Fenster- oder randlosen Modus sichtbar. Es nimmt nie den Fokus und klickt nie etwas im Spiel.')}
      </p>
    </>
  );
}

// Discord: Rich Presence + Webhook (src-tauri/src/discord.rs). Die Webhook-URL kommt nie zurück, nur maskiert.
const DISCORD_STATUS = {
  off: ['Aus', ''],
  noId: ['Application-ID fehlt', 'warn'],
  waiting: ['Bereit – wartet auf Warframe', ''],
  connecting: ['Verbinde mit Discord …', ''],
  connected: ['Verbunden', 'ok'],
  noDiscord: ['Discord läuft nicht – neuer Versuch alle 30 Sekunden', 'warn'],
  error: ['Fehler', 'err'],
};
const DISCORD_SHOW = [
  ['discordShowMr', 'Meisterschaftsrang (MR)'],
  ['discordShowActivity', 'Aktuelle Aktivität (Orbiter, Mission, Relais …)', 'Wird aus der Log-Datei des Spiels (EE.log) gelesen.'],
  ['discordShowName', 'Spielername (Warframe-Name)', 'Aus Datenschutzgründen standardmäßig aus.'],
  ['discordIdle', 'Ohne laufendes Spiel: „Plant mit Cephalon Merlin“'],
  ['discordButton', 'Knopf „Cephalon Merlin“ (Link zur GitHub-Seite)'],
];
const DISCORD_HOOKS = [
  ['priceAlert', 'Preis-Alarm ausgelöst'],
  ['foundry', 'Foundry-Bauauftrag fertig'],
  ['baro', "Baro Ki'Teer (Ankunft und Ducats-Erinnerung)"],
  ['world', 'Zyklus-Wechsel, neue Sortie und Archon-Jagd'],
];

function Discord() {
  const [status, setStatus] = createSignal({ state: 'off' });
  const [appId, setAppId] = createSignal(settings.discordAppId);
  const [hook, setHook] = createSignal({ set: false, masked: '' });
  const [hookInput, setHookInput] = createSignal('');
  const [msg, setMsg] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  if (isTauri) {
    call('discord_status').then(setStatus).catch(() => {});
    call('discord_webhook').then(setHook).catch(() => {});
    onCleanup(on('discord-status', setStatus));
  }
  const idValid = () => appId() === '' || /^\d{17,21}$/.test(appId());
  const saveId = () => idValid() && appId() !== settings.discordAppId && setSettings({ discordAppId: appId() });
  const tone = () => (DISCORD_STATUS[status().state] ?? DISCORD_STATUS.off);
  const rpcOff = () => !settings.discordRpc;
  // Antwort des Rust-Teils: { ok, error?, set, masked }
  const run = async (cmd, args, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call(cmd, args);
      setHook({ set: r.set, masked: r.masked });
      setMsg(r.ok ? { ok: true, text: t(okText) } : { ok: false, text: t(r.error) });
      return r;
    } catch (e) {
      setMsg({ ok: false, text: t(e.message) });
    } finally {
      setBusy(false);
    }
  };
  const saveHook = async () => {
    const r = await run('discord_webhook_set', { url: hookInput().trim() }, 'Webhook gespeichert.');
    if (r?.ok) setHookInput('');
  };
  const box = (k, label, hint, disabled) => (
    <label class="set-row">
      <input type="checkbox" checked={!!settings[k]} disabled={disabled()} onChange={(e) => setSettings({ [k]: e.currentTarget.checked })} />
      <span>
        {t(label)}
        <Show when={hint}>
          <small>{t(hint)}</small>
        </Show>
      </span>
    </label>
  );
  return (
    <>
      <h4>{t('Rich Presence')}</h4>
      <Check k="discordRpc" label="Status in Discord anzeigen (Rich Presence)" hint="Zeigt in deinem Discord-Profil, dass du Warframe spielst. Braucht die Discord-Desktop-App auf diesem PC." />
      <div class="set-section" classList={{ off: rpcOff() }}>
        <div class="set-line">
          <span>{t('Application-ID')}</span>
          <input
            class="dc-input"
            classList={{ bad: !idValid() }}
            value={appId()}
            placeholder="123456789012345678"
            inputMode="numeric"
            spellcheck={false}
            onInput={(e) => setAppId(e.currentTarget.value.replace(/\s/g, ''))}
            onBlur={saveId}
            onKeyDown={(e) => e.key === 'Enter' && saveId()}
          />
          <Show when={!idValid()}>
            <small class="dc-err">{t('Nur Ziffern (17–21 Stellen)')}</small>
          </Show>
        </div>
        <div class="set-line">
          <span>{t('Status')}</span>
          <b class={`dc-tone ${tone()[1]}`}>
            <Gamepad2 size={14} /> {t(tone()[0])}
            {status().state === 'connected' && status().user ? ` – ${status().user}` : ''}
            {status().state === 'error' && status().message ? `: ${t(status().message)}` : ''}
          </b>
          <Show when={isTauri && !rpcOff() && ['noDiscord', 'error'].includes(status().state)}>
            <button class="btn" onClick={() => call('discord_retry').then(setStatus).catch(() => {})}>
              <RefreshCw size={14} /> {t('Jetzt verbinden')}
            </button>
          </Show>
        </div>
        <h4>{t('Was wird angezeigt?')}</h4>
        <For each={DISCORD_SHOW}>{([k, l, h]) => box(k, l, h, rpcOff)}</For>
        <details class="dc-guide">
          <summary>{t('Anleitung: Application-ID bekommen (einmalig, ca. 3 Minuten)')}</summary>
          <ol>
            <li>{t('Developer Portal öffnen und mit deinem Discord-Konto anmelden.')}</li>
            <li>{t('„New Application“ klicken und als Namen „Cephalon Merlin“ (oder „Warframe“) eingeben – der Name steht später in deinem Status hinter „Spielt“.')}</li>
            <li>{t('Unter „General Information“ die „Application ID“ kopieren und oben einfügen.')}</li>
            <li>{t('Unter „Rich Presence“ → „Art Assets“ → „Add Image(s)“ das Logo hochladen und als Namen genau „logo“ eintragen. Die Datei bekommst du über „Logo-Datei zeigen“.')}</li>
            <li>{t('Speichern. Neue Bilder brauchen bei Discord manchmal einige Minuten, bis sie erscheinen.')}</li>
          </ol>
          <div class="dc-buttons">
            <button class="btn" onClick={() => openExternal('https://discord.com/developers/applications')}>
              <ExternalLink size={14} /> {t('Developer Portal öffnen')}
            </button>
            <button class="btn" onClick={() => call('discord_show_logo')}>
              <FolderOpen size={14} /> {t('Logo-Datei zeigen')}
            </button>
          </div>
        </details>
      </div>

      <h4>{t('Webhook')}</h4>
      <p class="muted small">
        {t('Schickt ausgewählte Meldungen als Nachricht in einen Discord-Kanal. Webhook anlegen: Kanal bearbeiten → Integrationen → Webhooks → Neuer Webhook → „Webhook-URL kopieren“.')}
      </p>
      <div class="set-line">
        <Webhook size={16} />
        <Show when={hook().set} fallback={<span class="muted">{t('Kein Webhook eingetragen')}</span>}>
          <code class="dc-masked">{hook().masked}</code>
          <button class="icon-btn" onClick={() => run('discord_webhook_set', { url: '' }, 'Webhook entfernt.')} disabled={busy()} title={t('Webhook entfernen')}>
            <Trash2 size={14} />
          </button>
        </Show>
      </div>
      <div class="set-line">
        <input
          class="dc-input wide"
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={hookInput()}
          placeholder="https://discord.com/api/webhooks/…"
          onInput={(e) => setHookInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && hookInput().trim() && saveHook()}
        />
        <button class="btn" onClick={saveHook} disabled={busy() || !hookInput().trim()}>
          <CheckIcon size={14} /> {t(hook().set ? 'Ersetzen' : 'Speichern')}
        </button>
      </div>
      <div class="set-section" classList={{ off: !hook().set }}>
        <h4>{t('Diese Meldungen senden')}</h4>
        <For each={DISCORD_HOOKS}>
          {([key, l]) => (
            <label class="set-row">
              <input
                type="checkbox"
                checked={!!settings.discordHooks?.[key]}
                disabled={!hook().set}
                onChange={(e) => setSettings({ discordHooks: { ...settings.discordHooks, [key]: e.currentTarget.checked } })}
              />
              <span>{t(l)}</span>
            </label>
          )}
        </For>
        <p class="muted small">{t('Gesendet wird zusammen mit der Windows-Benachrichtigung – die jeweilige Meldung muss unter „Benachrichtigungen“ eingeschaltet sein.')}</p>
        <button class="btn set-test" onClick={() => run('discord_webhook_test', {}, 'Test gesendet – schau in deinen Discord-Kanal.')} disabled={busy() || !hook().set}>
          <Send size={14} /> {t('Test senden')}
        </button>
      </div>
      <Show when={msg()}>
        <p class={`dc-msg ${msg().ok ? 'ok' : 'err'}`}>{msg().text}</p>
      </Show>
      <p class="muted small">
        {t('Die Webhook-URL bleibt nur auf diesem PC (verschlüsselt im Datenordner) und wird nirgends angezeigt oder protokolliert.')}{' '}
        {t('Einen Webhook aus der bisherigen Version musst du einmal neu eintragen – er war mit einem Schlüssel verschlüsselt, den nur die alte App lesen kann.')}
      </p>
    </>
  );
}

const TABS = [
  ['general', 'Allgemein', General],
  ['appearance', 'Aussehen', Appearance],
  ['overlays', 'Overlays', Overlays],
  ['notifications', 'Benachrichtigungen', Notifications],
  ['discord', 'Discord', Discord],
];

export default function Settings(props) {
  const [tab, setTab] = createSignal('general');
  const onKey = (e) => e.key === 'Escape' && props.onClose();
  onMount(() => window.addEventListener('keydown', onKey));
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal settings" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3>{t('Einstellungen')}</h3>
          <button class="icon-btn" onClick={props.onClose} aria-label={t('Schließen')}>
            <X size={20} />
          </button>
        </div>
        <div class="set-tabs">
          <For each={TABS}>
            {([id, label]) => (
              <button classList={{ active: id === tab() }} onClick={() => setTab(id)}>
                {t(label)}
              </button>
            )}
          </For>
        </div>
        <div class="set-body">
          <Show when={!isTauri}>
            <p class="notice">{t('Browser-Testmodus: Einstellungen wirken erst in der Desktop-App.')}</p>
          </Show>
          <Dynamic component={TABS.find(([id]) => id === tab())[2]} />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X, BellRing, Check as CheckIcon, RotateCcw } from 'lucide-react';
import { useSettings, setSettings, HOTKEYS, keyLabel } from '../lib/settings.js';
import { isElectron } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { THEMES, COLOR_KEYS, resolveColors, useDraftSave } from '../lib/theme.js';
import { UpdateCheck } from './UpdateNotice.jsx';

// Einstellungs-Fenster im AlecaFrame-Stil: Reiter oben, darunter Haken-Listen.
// Jede Einstellung hier wirkt auch wirklich – nichts ist nur Deko.

function Check({ k, label, hint, s }) {
  const t = useT();
  return (
    <label className="set-row">
      <input type="checkbox" checked={!!s[k]} onChange={(e) => setSettings({ [k]: e.target.checked })} />
      <span>
        {t(label)}
        {hint && <small>{t(hint)}</small>}
      </span>
    </label>
  );
}

function General({ s }) {
  const t = useT();
  return (
    <>
      <div className="set-line">
        <span>{t('Sprache')}</span>
        <select value={s.language} onChange={(e) => setSettings({ language: e.target.value })}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>
      <Check s={s} k="confirmClose" label="Nachfragen, bevor das Hauptfenster geschlossen wird" />
      <Check
        s={s}
        k="hideFounders"
        label="Founders-Items ausblenden (Excalibur Prime, Skana Prime und Lato Prime)"
        hint="Gibt es nicht mehr – zählen dann auch im Mastery-Helfer nicht als fehlend."
      />
      <Check s={s} k="secondMonitor" label="Cephalon Merlin beim Start auf den zweiten Monitor verschieben" />
      <AutoSync s={s} />
      <h4>{t('Updates')}</h4>
      <UpdateCheck />
    </>
  );
}

// Auto-Sync: läuft im Main-Prozess (electron/autoSync.cjs), nur solange Warframe läuft und du eingeloggt bist
const AUTO_SYNC_MINUTES = [0, 5, 10, 15, 30, 60, 120];
function AutoSync({ s }) {
  const t = useT();
  return (
    <>
      <h4>{t('Spiel-Sync')}</h4>
      <Check
        s={s}
        k="autoSync"
        label="Automatisch synchronisieren"
        hint="Nur solange Warframe läuft und du eingeloggt bist. Jeder Sync durchsucht kurz den Spielspeicher und erzeugt etwas Last."
      />
      <div className={`set-section ${s.autoSync ? '' : 'off'}`}>
        <label className="set-row">
          <input
            type="checkbox"
            checked={!!s.autoSyncMission}
            disabled={!s.autoSync}
            onChange={(e) => setSettings({ autoSyncMission: e.target.checked })}
          />
          <span>
            {t('Nach jeder Mission')}
            <small>{t('Wenige Sekunden nach der Rückkehr ins Schiff bzw. in den Hub (erkannt über EE.log).')}</small>
          </span>
        </label>
        <div className="set-line">
          <span>{t('Zusätzlich regelmäßig')}</span>
          <select value={s.autoSyncMinutes} disabled={!s.autoSync} onChange={(e) => setSettings({ autoSyncMinutes: Number(e.target.value) })}>
            {AUTO_SYNC_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m ? t('alle {n} Minuten', { n: m }) : t('aus')}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

const QUICK_ACCENTS = ['#6c4ce0', '#2f7de1', '#14b8c4', '#22a06b', '#9ccc3a', '#c9a24a', '#e0603a', '#d6336c', '#c04ee0', '#8d96ad'];

function Appearance({ s: saved }) {
  const t = useT();
  const [s, change] = useDraftSave(saved);
  const colors = resolveColors(s);
  const own = s.colors ?? {};
  const groups = [...new Set(COLOR_KEYS.map((c) => c.group))];
  const setColor = (key, value) => {
    const next = { ...own };
    if (value) next[key] = value;
    else delete next[key];
    // Akzent über die Schnellwahl und einzeln: einheitlich in "colors" halten
    change(key === 'accent' ? { colors: next, accent: '' } : { colors: next });
  };
  const customized = Object.keys(own).length > 0 || !!s.accent;

  return (
    <>
      <h4>{t('Theme')}</h4>
      <div className="theme-grid">
        {THEMES.map((th) => (
          <button
            key={th.id}
            className={`theme-swatch ${s.theme === th.id ? 'active' : ''}`}
            onClick={() => setSettings({ theme: th.id, accent: '', colors: {} })}
            style={{ background: th.colors.bg, borderColor: s.theme === th.id ? th.colors.accent : th.colors.line }}
          >
            <span className="theme-preview">
              <i style={{ background: th.colors.panel }} />
              <i style={{ background: th.colors.card }} />
              <i style={{ background: th.colors.accent }} />
            </span>
            <span className="theme-name">{t(th.label)}</span>
            {s.theme === th.id && <CheckIcon size={14} className="theme-check" style={{ color: th.colors.accent }} />}
          </button>
        ))}
      </div>

      <h4>{t('Akzentfarbe')}</h4>
      <div className="theme-accents">
        {QUICK_ACCENTS.map((c) => (
          <button
            key={c}
            className={`theme-dot ${colors.accent.toLowerCase() === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor('accent', c)}
            title={c}
          />
        ))}
      </div>

      <div className="set-head">
        <h4>{t('Eigene Farben')}</h4>
        {customized && (
          <button className="btn" onClick={() => setSettings({ accent: '', colors: {} })} title={t('Alle Farben auf das Theme zurücksetzen')}>
            <RotateCcw size={14} /> {t('Alle zurücksetzen')}
          </button>
        )}
      </div>
      <div className="color-groups">
        {groups.map((g) => (
          <div key={g} className="color-group">
            <small>{t(g)}</small>
            {COLOR_KEYS.filter((c) => c.group === g).map((c) => (
              <label key={c.key} className="color-row">
                <input type="color" className="set-color" value={colors[c.key]} onChange={(e) => setColor(c.key, e.target.value)} />
                <span>{t(c.label)}</span>
                {own[c.key] || (c.key === 'accent' && s.accent) ? (
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      setColor(c.key, '');
                    }}
                    title={t('Farbe des Themes verwenden')}
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : (
                  <code>{colors[c.key]}</code>
                )}
              </label>
            ))}
          </div>
        ))}
      </div>

      <h4>{t('Form & Größe')}</h4>
      <div className="set-line">
        <span>{t('Eckenrundung')}</span>
        <input type="range" min="0" max="20" step="1" value={s.radius} onChange={(e) => change({ radius: Number(e.target.value) })} />
        <b>{s.radius} px</b>
      </div>
      <div className="set-line">
        <span>{t('Größe der Oberfläche')}</span>
        <input type="range" min="0.01" max="2" step="0.01" value={s.uiScale} onChange={(e) => change({ uiScale: Number(e.target.value) })} />
        <b>{Math.round(s.uiScale * 100)} %</b>
      </div>
    </>
  );
}

function Overlays({ s }) {
  const t = useT();
  return (
    <>
      <Check s={s} k="rewardsOverlay" label="Belohnungs-Overlay nach einer Spalten-Mission" />
      <Check s={s} k="selectionOverlay" label="Empfehlungen und Zahlen in der Relikt-Auswahl" />
      <Check s={s} k="walletOnOverlay" label="Platin und Ducats des Kontos im Belohnungs-Overlay zeigen" />
      <Check
        s={s}
        k="copyRewards"
        label="Belohnungs-Infos in die Zwischenablage kopieren"
        hint="Zum Einfügen in den Squad-Chat: Name, Platin und Ducats der 4 Belohnungen."
      />
      <div className="set-line">
        <span>{t('Größe des Belohnungs-Overlays')}</span>
        <input
          type="range"
          min="0.8"
          max="1.6"
          step="0.05"
          value={s.rewardsScale}
          onChange={(e) => setSettings({ rewardsScale: Number(e.target.value) })}
        />
        <b>{Math.round(s.rewardsScale * 100)} %</b>
      </div>
      <div className="set-line">
        <span>{t('Taste für „Jetzt scannen“')}</span>
        <select value={s.hotkey} onChange={(e) => setSettings({ hotkey: e.target.value })}>
          {HOTKEYS.map((k) => (
            <option key={k} value={k}>
              {keyLabel(k, s.language)}
            </option>
          ))}
        </select>
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

function Notifications({ s }) {
  const t = useT();
  const [tested, setTested] = useState(false);
  const test = async () => {
    if (Notification.permission === 'default') await Notification.requestPermission();
    new Notification('Cephalon Merlin', { body: t('So sehen die Benachrichtigungen aus.') });
    setTested(true);
  };
  return (
    <>
      <Check s={s} k="notify" label="Benachrichtigungen über Windows senden" />
      <div className={`set-section ${s.notify ? '' : 'off'}`}>
        <h4>{t('Zyklus-Wechsel')}</h4>
        {CYCLES.map(([key, label]) => (
          <label key={key} className="set-row">
            <input
              type="checkbox"
              checked={!!s.notifyCycles[key]}
              disabled={!s.notify}
              onChange={(e) => setSettings({ notifyCycles: { ...s.notifyCycles, [key]: e.target.checked } })}
            />
            <span>{t(label)}</span>
          </label>
        ))}
        <div className="set-line">
          <span>{t('Minuten vor dem Wechsel benachrichtigen')}</span>
          <input
            type="number"
            min="0"
            max="30"
            value={s.notifyMinutes}
            disabled={!s.notify}
            onChange={(e) => setSettings({ notifyMinutes: Number(e.target.value) || 0 })}
          />
        </div>
        <h4>{t('Händler')}</h4>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifyBaro} disabled={!s.notify} onChange={(e) => setSettings({ notifyBaro: e.target.checked })} />
          <span>{t("Baro Ki'Teer ist angekommen")}</span>
        </label>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifyBaroDucats} disabled={!s.notify} onChange={(e) => setSettings({ notifyBaroDucats: e.target.checked })} />
          <span>{t('3 Stunden vor Baros Ankunft: Ducats zum Opfern')}</span>
        </label>
        <h4>{t('Sortie & Archon-Jagd')}</h4>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifySortie} disabled={!s.notify} onChange={(e) => setSettings({ notifySortie: e.target.checked })} />
          <span>{t('Neue Sortie ist da')}</span>
        </label>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifyArchon} disabled={!s.notify} onChange={(e) => setSettings({ notifyArchon: e.target.checked })} />
          <span>{t('Neue Archon-Jagd ist da')}</span>
        </label>
        <h4>{t('Foundry')}</h4>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifyFoundry} disabled={!s.notify} onChange={(e) => setSettings({ notifyFoundry: e.target.checked })} />
          <span>{t('Foundry fertig')}</span>
        </label>
        <h4>{t('Preis-Alarme')}</h4>
        <label className="set-row">
          <input type="checkbox" checked={!!s.notifyPriceAlerts} disabled={!s.notify} onChange={(e) => setSettings({ notifyPriceAlerts: e.target.checked })} />
          <span>
            {t('Preis-Alarme')}
            <small>{t('Alarme legst du in den Item-Details an, die Übersicht ist unter Handel → Preis-Alarme.')}</small>
          </span>
        </label>
        <div className="set-line">
          <span>{t('Preise prüfen alle')}</span>
          <select
            value={s.priceAlertMinutes}
            disabled={!s.notify || !s.notifyPriceAlerts}
            onChange={(e) => setSettings({ priceAlertMinutes: Number(e.target.value) })}
          >
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {t('{n} Minuten', { n: m })}
              </option>
            ))}
          </select>
        </div>
        <button className="btn set-test" onClick={test} disabled={!s.notify}>
          <BellRing size={14} /> {t(tested ? 'Nochmal testen' : 'Test-Benachrichtigung')}
        </button>
      </div>
      <p className="muted small">{t('Benachrichtigungen kommen nur, solange Cephalon Merlin läuft.')}</p>
    </>
  );
}

const TABS = [
  ['general', 'Allgemein', General],
  ['appearance', 'Aussehen', Appearance],
  ['overlays', 'Overlays', Overlays],
  ['notifications', 'Benachrichtigungen', Notifications],
];

export default function Settings({ onClose }) {
  const s = useSettings();
  const t = useT();
  const [tab, setTab] = useState('general');
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const Body = TABS.find(([id]) => id === tab)[2];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Einstellungen')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('Schließen')}>
            <X size={20} />
          </button>
        </div>
        <div className="set-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={id === tab ? 'active' : ''} onClick={() => setTab(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        <div className="set-body">
          {!isElectron && <p className="notice">{t('Browser-Testmodus: Einstellungen wirken erst in der Desktop-App.')}</p>}
          <Body s={s} />
        </div>
      </div>
    </div>
  );
}

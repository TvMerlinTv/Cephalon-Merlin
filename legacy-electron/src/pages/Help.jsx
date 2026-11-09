import { useEffect, useState } from 'react';
import {
  Hammer, ChevronsUp, Package, Flame, Dices, Store, BarChart3, FolderOpen, DatabaseZap, ExternalLink,
  Loader2, CheckCircle2, ChevronRight, Keyboard, MonitorPlay, RefreshCw, Gamepad2, ScrollText, Wrench,
} from 'lucide-react';
import { Logo } from '../components/Icons.jsx';
import { game, isElectron, openExternal } from '../lib/api.js';
import { useSettings, keyLabel } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { UpdateCheck } from '../components/UpdateNotice.jsx';

const PAGES = [
  { id: 'foundry', icon: Hammer, label: 'Foundry', text: 'Alle Waffen, Frames und Begleiter mit ihren Bauteilen – was du hast, was fehlt, mit Filtern.' },
  { id: 'mastery', icon: ChevronsUp, label: 'Mastery-Helfer', text: 'Was du noch meistern musst. Mit To-Do-Liste und den Relikten, die die fehlenden Teile droppen.' },
  { id: 'inventory', icon: Package, label: 'Inventar', text: 'Deine handelbaren Items mit Marktpreisen (WTS/WTB).' },
  { id: 'relics', icon: Flame, label: 'Relikt-Planer', text: 'Deine Relikte, ihr erwarteter Platin- und Ducat-Wert und was sich zu öffnen lohnt.' },
  { id: 'builds', icon: Wrench, label: 'Builds', text: 'Die beliebtesten Builds von overframe.gg mit Mods, Guide und Marktpreisen. Favoriten merken und Builds mit Checkliste fertigstellen.' },
  { id: 'rivens', icon: Dices, label: 'Rivens', text: 'Alle Rivens mit Werten bei Rang 8, Würfelglück, Kuva-Kosten und Marktpreisen.' },
  { id: 'market', icon: Store, label: 'Warframe Market', text: 'Preise für Sets und Einzelteile direkt von warframe.market.' },
  { id: 'stats', icon: BarChart3, label: 'Statistiken', text: 'Verlauf von Platin, Credits, Endo, Ducats, Kuva und mehr – ein Messpunkt pro Sync.' },
];

const FAQ = [
  {
    q: 'Der Sync mit dem Spiel klappt nicht',
    a: 'Warframe muss laufen und du musst eingeloggt sein. Hilft das nicht, geh einmal in einen Ladebildschirm (z. B. Mission starten oder ins Dojo) und synchronisiere erneut. Läuft Warframe als Administrator, muss Cephalon Merlin das auch.',
  },
  {
    q: 'Das Overlay erscheint nicht im Spiel',
    a: 'Stell Warframe auf „Randloses Fenster“ (Optionen → Anzeige). Über echtem Vollbild kann Windows kein Fenster zeigen. Prüfe außerdem unter Einstellungen → Overlays, ob das Overlay eingeschaltet ist.',
  },
  {
    q: 'Zahlen in der Relikt-Auswahl fehlen oder springen',
    a: 'Die Texterkennung braucht einen Moment, bis das Bild ruhig ist. Scroll langsam oder warte kurz. Mit der Scan-Taste kannst du jederzeit neu scannen.',
  },
  {
    q: 'Preise fehlen oder sind veraltet',
    a: 'Preise kommen live von warframe.market und werden 15 Minuten zwischengespeichert. Ist die Seite gerade nicht erreichbar, zeigt Cephalon Merlin die zuletzt geladenen Preise.',
  },
  {
    q: 'Windows warnt beim Start vor der .exe',
    a: 'Die .exe ist nicht signiert, daher kann SmartScreen warnen. „Weitere Informationen“ → „Trotzdem ausführen“.',
  },
  {
    q: 'Was liest Cephalon Merlin aus dem Spiel?',
    a: 'Cephalon Merlin liest nur und verändert nichts am Spiel. Für dein Inventar wird der Sitzungs-Token aus dem laufenden Spiel gelesen und damit einmal dein Inventar von Digital Extremes geladen. Der Token wird weder gespeichert noch angezeigt oder weitergegeben. Das Overlay liest den Bildschirm per Texterkennung – es klickt nie etwas im Spiel.',
  },
  {
    q: 'Wo liegen meine Daten?',
    a: 'Einstellungen, Inventar, To-Do-Liste, Statistik-Verlauf und die Item-Datenbanken liegen im Datenordner (Knopf oben). Löschen setzt Cephalon Merlin zurück.',
  },
];

const SOURCES = [
  { name: 'warframe.market', url: 'https://warframe.market', text: 'Preise, Riven-Auktionen, Dispositionen' },
  { name: 'Warframe-Weltstatus (Digital Extremes)', url: 'https://www.warframe.com', text: 'Zyklen, Spalten, Void-Stürme, Baro Ki’Teer – live' },
  { name: 'WFCD / warframe-worldstate-data', url: 'https://github.com/WFCD/warframe-worldstate-data', text: 'Namen der Knoten und Missionstypen' },
  { name: 'warframestat.us', url: 'https://hub.warframestat.us', text: 'Sammelpreise (WFInfo)' },
  { name: 'WFCD / warframe-items', url: 'https://github.com/WFCD/warframe-items', text: 'Item-Datenbank, Bauteile, Drops, Bilder' },
  { name: 'warframe-public-export-plus', url: 'https://github.com/calamity-inc/warframe-public-export-plus', text: 'Riven-Basiswerte und Herausforderungen' },
  { name: 'overframe.gg', url: 'https://overframe.gg', text: 'Builds und Guides der Community' },
  { name: 'Warframe Wiki', url: 'https://wiki.warframe.com', text: 'Links zu Items' },
];

function Faq({ item }) {
  const t = useT();
  return (
    <details className="help-faq">
      <summary>
        <ChevronRight size={16} />
        {t(item.q)}
      </summary>
      <p>{t(item.a)}</p>
    </details>
  );
}

export default function Help({ onNavigate }) {
  const t = useT();
  const s = useSettings();
  const [info, setInfo] = useState(null);
  const [refresh, setRefresh] = useState(null); // null | 'busy' | 'done' | Fehlertext

  useEffect(() => {
    if (isElectron) window.wf.appInfo?.().then(setInfo).catch(() => {});
  }, []);

  const reloadDbs = async () => {
    setRefresh('busy');
    try {
      await Promise.all([game.masteryDb(true), game.relicDb(true)]);
      setRefresh('done');
    } catch (e) {
      setRefresh(e.message ?? String(e));
    }
  };

  return (
    <div className="page help">
      <section className="help-hero">
        <Logo size={46} />
        <div>
          <h2>Cephalon Merlin</h2>
          <p className="muted">
            {t('Warframe-Begleiter für Inventar, Mastery, Relikte, Rivens und Markt.')}
            {info && (
              <>
                {' '}
                · {t('Version')} {info.version} · Electron {info.electron}
              </>
            )}
          </p>
        </div>
        <div className="help-actions">
          {isElectron && (
            <button className="btn" onClick={() => window.wf.openDataDir()} title={info?.dataDir}>
              <FolderOpen size={15} /> {t('Datenordner öffnen')}
            </button>
          )}
          {isElectron && (
            <button className="btn" onClick={() => window.wf.openLog?.()} title={t('Fehlerprotokoll im Explorer zeigen')}>
              <ScrollText size={15} /> {t('Fehlerprotokoll')}
            </button>
          )}
          <button className="btn" onClick={reloadDbs} disabled={refresh === 'busy'} title={t('Item- und Relikt-Datenbank jetzt neu herunterladen')}>
            {refresh === 'busy' ? <Loader2 size={15} className="spin" /> : refresh === 'done' ? <CheckCircle2 size={15} /> : <DatabaseZap size={15} />}{' '}
            {t(refresh === 'done' ? 'Datenbanken aktuell' : 'Datenbanken neu laden')}
          </button>
        </div>
      </section>
      {refresh && !['busy', 'done'].includes(refresh) && <p className="err">{refresh}</p>}
      <UpdateCheck />

      <div className="help-cols">
        <section className="help-card">
          <h3>{t('Erste Schritte')}</h3>
          <ol className="help-steps">
            <li>
              <Gamepad2 size={18} />
              <span>{t('Warframe starten und einloggen.')}</span>
            </li>
            <li>
              <RefreshCw size={18} />
              <span>{t('Oben links auf „Mit Spiel synchronisieren“ klicken – danach kennt Cephalon Merlin dein Inventar.')}</span>
            </li>
            <li>
              <MonitorPlay size={18} />
              <span>{t('Warframe auf „Randloses Fenster“ stellen. Dann zeigt das Overlay nach Spalten-Missionen die Belohnungen und in der Relikt-Auswahl Empfehlungen.')}</span>
            </li>
            <li>
              <Keyboard size={18} />
              <span>
                {t('Mit der Taste {key} scannst du jederzeit von Hand.', { key: keyLabel(s.hotkey, s.language) })}
              </span>
            </li>
          </ol>
        </section>

        <section className="help-card">
          <h3>{t('Bereiche')}</h3>
          <ul className="help-pages">
            {PAGES.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.id}>
                  <button onClick={() => onNavigate?.(p.id)}>
                    <Icon size={18} />
                    <span>
                      <b>{t(p.label)}</b>
                      <small>{t(p.text)}</small>
                    </span>
                    <ChevronRight size={16} className="muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="help-card">
        <h3>{t('Häufige Fragen')}</h3>
        {FAQ.map((f) => (
          <Faq key={f.q} item={f} />
        ))}
      </section>

      <section className="help-card">
        <h3>{t('Datenquellen')}</h3>
        <ul className="help-sources">
          {SOURCES.map((src) => (
            <li key={src.name}>
              <button onClick={() => openExternal(src.url)}>
                <b>{src.name}</b>
                <small>{t(src.text)}</small>
                <ExternalLink size={14} className="muted" />
              </button>
            </li>
          ))}
        </ul>
        <p className="muted help-legal">
          {t('Cephalon Merlin ist ein Fan-Projekt und nicht mit Digital Extremes verbunden. Warframe und alle zugehörigen Namen und Bilder gehören Digital Extremes Ltd.')}
        </p>
      </section>
    </div>
  );
}

import { createResource, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  Hammer, ChevronsUp, Package, Flame, Dices, Store, ChartColumn, FolderOpen, ExternalLink, ChevronRight,
  Keyboard, MonitorPlay, RefreshCw, Gamepad2, ScrollText, Wrench, Timer,
} from 'lucide-solid';
import { Logo } from '../components/Icons.jsx';
import { UpdateCheck } from '../components/UpdateNotice.jsx';
import { call, isTauri, openExternal } from '../lib/ipc.js';
import { settings, keyLabel } from '../lib/settings.js';
import { t } from '../lib/i18n.js';

const PAGES = [
  { id: 'inventory', icon: Package, label: 'Inventar', text: 'Deine handelbaren Items mit Marktpreisen (WTS/WTB).' },
  { id: 'world', icon: Timer, label: 'Weltstatus', text: 'Zyklen, Spalten, Sortie, Archon-Jagd, Nightwave und Baro Ki’Teer – live.' },
  { id: 'relics', icon: Flame, label: 'Relikt-Planer', text: 'Deine Relikte, ihr erwarteter Platin- und Ducat-Wert und was sich zu öffnen lohnt.' },
  { id: 'mastery', icon: ChevronsUp, label: 'Mastery-Helfer', text: 'Was du noch meistern musst. Mit To-Do-Liste und den Relikten, die die fehlenden Teile droppen.' },
  { id: 'foundry', icon: Hammer, label: 'Foundry', text: 'Alle Waffen, Frames und Begleiter mit ihren Bauteilen – was du hast, was fehlt, mit Filtern.' },
  { id: 'rivens', icon: Dices, label: 'Rivens', text: 'Alle Rivens mit Werten bei Rang 8, Würfelglück, Kuva-Kosten und Marktpreisen.' },
  { id: 'market', icon: Store, label: 'Warframe Market', text: 'Preise für Sets und Einzelteile direkt von warframe.market.' },
  { id: 'builds', icon: Wrench, label: 'Builds', text: 'Die beliebtesten Builds von overframe.gg mit Mods, Guide und Marktpreisen. Favoriten merken und Builds mit Checkliste fertigstellen.' },
  { id: 'stats', icon: ChartColumn, label: 'Statistiken', text: 'Verlauf von Platin, Credits, Endo, Ducats, Kuva und mehr – ein Messpunkt pro Sync.' },
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
    q: 'Was ist die Rust-Version?',
    a: 'Cephalon Merlin RS ist eine Neuentwicklung mit Rust und Tauri: kleinere .exe, weniger Arbeitsspeicher, schnellerer Start. Beim ersten Start übernimmt sie Inventar, To-Do-Liste, Statistiken und Einstellungen der bisherigen Version – die bisherige Version bleibt unverändert.',
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

export default function Help(props) {
  const [info] = createResource(() => (isTauri ? call('app_info') : null));

  return (
    <div class="page help">
      <section class="help-hero">
        <Logo size={46} />
        <div>
          <h2>Cephalon Merlin</h2>
          <p class="muted">
            {t('Warframe-Begleiter für Inventar, Mastery, Relikte, Rivens und Markt.')}
            <Show when={info()}>
              {' '}
              · {t('Version')} {info().version} · Tauri {info().tauri} · WebView2 {info().webview}
            </Show>
          </p>
        </div>
        <Show when={isTauri}>
          <div class="help-actions">
            <button class="btn" onClick={() => call('open_data_dir')} title={info()?.dataDir}>
              <FolderOpen size={15} /> {t('Datenordner öffnen')}
            </button>
            <button class="btn" onClick={() => call('open_log')} title={t('Fehlerprotokoll im Explorer zeigen')}>
              <ScrollText size={15} /> {t('Fehlerprotokoll')}
            </button>
          </div>
        </Show>
      </section>
      <UpdateCheck />

      <div class="help-cols">
        <section class="help-card">
          <h3>{t('Erste Schritte')}</h3>
          <ol class="help-steps">
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
              <span>{t('Mit der Taste {key} scannst du jederzeit von Hand.', { key: keyLabel(settings.hotkey, settings.language) })}</span>
            </li>
          </ol>
        </section>

        <section class="help-card">
          <h3>{t('Bereiche')}</h3>
          <ul class="help-pages">
            <For each={PAGES}>
              {(p) => (
                <li>
                  <button onClick={() => props.onNavigate?.(p.id)}>
                    <Dynamic component={p.icon} size={18} />
                    <span>
                      <b>{t(p.label)}</b>
                      <small>{t(p.text)}</small>
                    </span>
                    <ChevronRight size={16} class="muted" />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>

      <section class="help-card">
        <h3>{t('Häufige Fragen')}</h3>
        <For each={FAQ}>
          {(f) => (
            <details class="help-faq">
              <summary>
                <ChevronRight size={16} />
                {t(f.q)}
              </summary>
              <p>{t(f.a)}</p>
            </details>
          )}
        </For>
      </section>

      <section class="help-card">
        <h3>{t('Datenquellen')}</h3>
        <ul class="help-sources">
          <For each={SOURCES}>
            {(src) => (
              <li>
                <button onClick={() => openExternal(src.url)}>
                  <b>{src.name}</b>
                  <small>{t(src.text)}</small>
                  <ExternalLink size={14} class="muted" />
                </button>
              </li>
            )}
          </For>
        </ul>
        <p class="muted help-legal">
          {t('Cephalon Merlin ist ein Fan-Projekt und nicht mit Digital Extremes verbunden. Warframe und alle zugehörigen Namen und Bilder gehören Digital Extremes Ltd.')}
        </p>
      </section>
    </div>
  );
}

// Willkommens-Dialog beim allerersten Start: Sprache, Aussehen und die drei Schritte bis zum ersten Sync.
import { For } from 'solid-js';
import { Gamepad2, MonitorPlay, RefreshCw, Search } from 'lucide-solid';
import { Logo } from './Icons.jsx';
import { settings, setSettings } from '../lib/settings.js';
import { THEMES } from '../lib/theme.js';
import { onEscape } from '../lib/keys.js';
import { t } from '../lib/i18n.js';

const QUICK = ['default', 'arcane', 'midnight'];

export default function Welcome(props) {
  onEscape(() => props.onClose());
  const themes = THEMES.filter((th) => QUICK.includes(th.id));
  return (
    <div class="modal-backdrop">
      <div class="modal welcome" role="dialog" aria-label={t('Willkommen bei Cephalon Merlin')}>
        <div class="welcome-head">
          <Logo size={54} />
          <div>
            <h3>{t('Willkommen bei Cephalon Merlin')}</h3>
            <p class="muted">{t('Dein Begleiter für Inventar, Mastery, Relikte und Handel in Warframe.')}</p>
          </div>
        </div>

        <div class="set-line">
          <span>{t('Sprache')}</span>
          <select value={settings.language} onChange={(e) => setSettings({ language: e.currentTarget.value })}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="set-line">
          <span>{t('Aussehen')}</span>
          <div class="seg seg-text">
            <For each={themes}>
              {(th) => (
                <button classList={{ active: settings.theme === th.id }} onClick={() => setSettings({ theme: th.id, accent: '', colors: {} })}>
                  {t(th.label)}
                </button>
              )}
            </For>
          </div>
        </div>

        <ol class="help-steps welcome-steps">
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
            <Search size={18} />
            <span>{t('Mit Strg+K findest du jede Seite und jedes Item.')}</span>
          </li>
        </ol>
        <p class="muted small">{t('Cephalon Merlin liest nur – es klickt nie im Spiel und speichert keine Zugangsdaten. Alles lässt sich später in den Einstellungen ändern.')}</p>
        <div class="update-actions">
          <button class="btn btn-primary" onClick={props.onClose}>
            {t('Los geht’s')}
          </button>
        </div>
      </div>
    </div>
  );
}

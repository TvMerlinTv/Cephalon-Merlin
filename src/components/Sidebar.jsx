import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  Hammer, ChevronsUp, Package, Flame, Dices, Store, ChartColumn, LifeBuoy, Settings, User, Wrench, HandCoins, Timer, Coins, Hexagon,
} from 'lucide-solid';
import { t, num } from '../lib/i18n.js';
import { game } from '../lib/game.js';
import { Plat, Ducat } from './Icons.jsx';

// Reihenfolge wie in der Electron-Version, dazu "Weltstatus" als eigene Seite
export const NAV = [
  { id: 'inventory', label: 'Inventar', icon: Package },
  { id: 'world', label: 'Weltstatus', icon: Timer },
  { id: 'relics', label: 'Relikt-Planer', icon: Flame },
  { id: 'mastery', label: 'Mastery-Helfer', icon: ChevronsUp },
  { id: 'foundry', label: 'Foundry', icon: Hammer },
  { id: 'rivens', label: 'Rivens', icon: Dices },
  { id: 'market', label: 'Warframe Market', icon: Store },
  { id: 'trade', label: 'Handel', icon: HandCoins },
  { id: 'builds', label: 'Builds', icon: Wrench },
  { id: 'stats', label: 'Statistiken', icon: ChartColumn },
  { id: 'help', label: 'Hilfe / Info', icon: LifeBuoy },
];

export const compact = (n) => (n == null ? '–' : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));

// Profilbild: aktiver Glyph aus dem Inventar, sonst Platzhalter
function Avatar(props) {
  const [broken, setBroken] = createSignal(false);
  return (
    <Show when={props.src && !broken()} fallback={<User size={26} />}>
      <img class="profile-glyph" src={props.src} alt="" onError={() => setBroken(true)} />
    </Show>
  );
}

export default function Sidebar(props) {
  const p = () => game.inventory?.player;
  return (
    <nav class="sidebar">
      <div class="profile" tabIndex={0}>
        <div class="profile-avatar">
          <Avatar src={p()?.avatar} />
          <span class="profile-mr">{p()?.mr ?? '–'}</span>
        </div>
        <div class="profile-name">{p()?.name ?? 'Tenno'}</div>

        <Show when={p()}>
          <div class="profile-card" role="tooltip">
            <div class="profile-card-id">
              <div class="profile-avatar">
                <Avatar src={p().avatar} />
                <span class="profile-mr">{p().mr ?? '–'}</span>
              </div>
              <div class="profile-name">{p().name ?? 'Tenno'}</div>
            </div>
            <div class="profile-card-mr" title={t('Mastery-Rang')}>
              <small>MR</small>
              {p().mr ?? '–'}
            </div>
            <div class="profile-card-stats">
              <span title={t('Platin')}>
                <Plat size={18} /> {num(p().platinum)}
              </span>
              <span title="Credits">
                <Coins size={18} class="ico-credits" /> {compact(p().credits)}
              </span>
              <span title="Ducats">
                <Ducat size={18} /> {num(p().ducats)}
              </span>
              <span title="Endo">
                <Hexagon size={18} class="ico-endo" /> {compact(p().endo)}
              </span>
            </div>
          </div>
        </Show>
      </div>

      <ul class="nav">
        <For each={NAV}>
          {(item) => (
            <li>
              <button classList={{ active: props.page === item.id }} onClick={() => props.onNavigate(item.id)}>
                <Dynamic component={item.icon} size={20} stroke-width={1.8} />
                <span>{t(item.label)}</span>
              </button>
            </li>
          )}
        </For>
      </ul>

      <button class="nav-settings" classList={{ active: props.page === 'settings' }} onClick={() => props.onNavigate('settings')}>
        <Settings size={20} stroke-width={1.8} />
        <span>{t('Einstellungen')}</span>
      </button>
    </nav>
  );
}

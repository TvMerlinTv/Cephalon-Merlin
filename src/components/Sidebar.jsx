import { useState } from 'react';
import {
  Hammer, ChevronsUp, Package, Flame, Dices, Store, BarChart3, LifeBuoy, Settings, User, Coins, Hexagon,
} from 'lucide-react';
import { HandCoins, Wrench } from 'lucide-react';
import { useGameData } from '../lib/GameData.jsx';
import { Plat, Ducat } from './Icons.jsx';
import { compact } from '../lib/format.js';
import { useT } from '../lib/i18n.js';

const NAV = [
  { id: 'foundry', label: 'Foundry', icon: Hammer },
  { id: 'mastery', label: 'Mastery-Helfer', icon: ChevronsUp },
  { id: 'inventory', label: 'Inventar', icon: Package },
  { id: 'relics', label: 'Relikt-Planer', icon: Flame },
  { id: 'builds', label: 'Builds', icon: Wrench },
  { id: 'rivens', label: 'Rivens', icon: Dices },
  { id: 'market', label: 'Warframe Market', icon: Store },
  { id: 'trade', label: 'Handel', icon: HandCoins },
  { id: 'stats', label: 'Statistiken', icon: BarChart3 },
  { id: 'help', label: 'Hilfe / Info', icon: LifeBuoy },
];

// Profilbild: aktiver Glyph aus dem Inventar, sonst Platzhalter
function Avatar({ src }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <User size={26} />;
  return <img className="profile-glyph" src={src} alt="" onError={() => setBroken(true)} />;
}

export default function Sidebar({ page, onNavigate }) {
  const { inventory } = useGameData();
  const p = inventory?.player;
  const t = useT();

  return (
    <nav className="sidebar">
      <div className="profile" tabIndex={0}>
        <div className="profile-avatar">
          <Avatar src={p?.avatar} />
          <span className="profile-mr">{p?.mr ?? '–'}</span>
        </div>
        <div className="profile-name">{p?.name ?? 'Tenno'}</div>

        {p && (
          <div className="profile-card" role="tooltip">
            <div className="profile-card-id">
              <div className="profile-avatar">
                <Avatar src={p?.avatar} />
                <span className="profile-mr">{p.mr ?? '–'}</span>
              </div>
              <div className="profile-name">{p.name ?? 'Tenno'}</div>
            </div>
            <div className="profile-card-mr" title={t('Mastery-Rang')}>
              <small>MR</small>
              {p.mr ?? '–'}
            </div>
            <div className="profile-card-stats">
              <span title={t('Platin')}>
                <Plat size={18} /> {p.platinum?.toLocaleString('de-DE') ?? '–'}
              </span>
              <span title="Credits">
                <Coins size={18} className="ico-credits" /> {compact(p.credits)}
              </span>
              <span title="Ducats">
                <Ducat size={18} /> {p.ducats?.toLocaleString('de-DE') ?? '–'}
              </span>
              <span title="Endo">
                <Hexagon size={18} className="ico-endo" /> {compact(p.endo)}
              </span>
            </div>
          </div>
        )}
      </div>

      <ul className="nav">
        {NAV.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <button className={page === id ? 'active' : ''} onClick={() => onNavigate(id)}>
              <Icon size={20} strokeWidth={1.8} />
              <span>{t(label)}</span>
            </button>
          </li>
        ))}
      </ul>

      <button className={`nav-settings ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
        <Settings size={20} strokeWidth={1.8} />
        <span>{t('Einstellungen')}</span>
      </button>
    </nav>
  );
}

// Kleine eigene Icons (Platin, Ducats, Logo) – der Rest kommt aus lucide-react.
import { useT } from '../lib/i18n.js';

// Cephalon Merlin: Zauberhut mit leuchtendem Cephalon-Kern (gleiche Formen wie build/make-icon.cjs)
export function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="17.2" rx="9.6" ry="2.5" fill="currentColor" opacity="0.75" />
      <path d="M6.6 16.6 9.4 10.4 11.6 6 13.6 3.2 16.4 1.6 15.2 3.6 15 6.6 15.6 10.6 17.4 16.6Z" fill="currentColor" />
      <path d="M12 8.7 14.3 12 12 15.3 9.7 12Z" fill="var(--accent-2)" />
      <path d="M12 10.4 13.1 12 12 13.6 10.9 12Z" fill="#fff" />
      <path d="M5.2 4.5 5.73 5.87 7.1 6.4 5.73 6.93 5.2 8.3 4.67 6.93 3.3 6.4 4.67 5.87Z" fill="var(--accent-2)" />
      <path d="M19.4 8 19.74 8.86 20.6 9.2 19.74 9.54 19.4 10.4 19.06 9.54 18.2 9.2 19.06 8.86Z" fill="var(--accent-2)" />
    </svg>
  );
}

export function Plat({ size = 14 }) {
  const t = useT();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="icon-plat" aria-label={t('Platin')}>
      <defs>
        <linearGradient id="pl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f7ff" />
          <stop offset="1" stopColor="#9aa3b8" />
        </linearGradient>
      </defs>
      <path d="M8 1 14 5v6l-6 4-6-4V5l6-4Z" fill="url(#pl)" />
      <path d="M8 1v14M2 5l12 6M14 5 2 11" stroke="#7d869c" strokeWidth=".6" />
    </svg>
  );
}

export function Ducat({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Ducats">
      <circle cx="8" cy="8" r="7" fill="#c9a24a" />
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="#7a5c1c" strokeWidth="1.2" />
      <path d="M8 4.8v6.4" stroke="#7a5c1c" strokeWidth="1.2" />
    </svg>
  );
}

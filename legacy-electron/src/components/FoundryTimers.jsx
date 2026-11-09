import { useState } from 'react';
import { Hammer, CheckCircle2, Package } from 'lucide-react';
import { countdown } from '../lib/format.js';
import { useFoundry } from '../lib/foundry.js';
import { useT } from '../lib/i18n.js';
import { useNow } from '../lib/useNow.js';

const hhmm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayOf = (ms) => new Date(ms).toDateString();

function BuildIcon({ src }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <Package size={22} className="ft-noimg" />;
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/** Laufende Foundry-Bauaufträge mit Countdown. `wide` = Variante für die Foundry-Seite. */
export default function FoundryTimers({ now: nowProp, wide = false }) {
  const ownNow = useNow(); // eigene Uhr, damit z. B. die Foundry-Seite nicht jede Sekunde neu rendert
  const now = nowProp ?? ownNow;
  const t = useT();
  const { list, syncedAt } = useFoundry();
  if (!list.length && !wide) return null; // im Panel nur zeigen, wenn etwas baut
  const ready = list.filter((b) => b.completesAt && b.completesAt <= now).length;
  const stand = syncedAt
    ? dayOf(syncedAt) === dayOf(now)
      ? t('Stand: Sync von {t}', { t: hhmm(syncedAt) })
      : t('Stand: Sync vom {d}', { d: new Date(syncedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })
    : null;

  return (
    <section className={`ft ${wide ? 'ft-wide' : ''}`}>
      <div className="ft-head">
        <h3>
          <Hammer size={15} /> {t('Foundry')}
          {ready > 0 && <span className="ft-ready">{t('{n} fertig', { n: ready })}</span>}
        </h3>
        {stand && <span className="muted small">{stand}</span>}
      </div>
      {!list.length && (
        <p className="muted small">{syncedAt ? t('In der Foundry wird gerade nichts gebaut.') : t('Noch kein Sync – synchronisiere, um laufende Bauaufträge zu sehen.')}</p>
      )}
      <ul className="ft-list">
        {list.map((b) => {
          const done = b.completesAt != null && b.completesAt <= now;
          return (
            <li key={`${b.recipe}|${b.completesAt}`} className={done ? 'done' : ''} title={b.completesAt ? new Date(b.completesAt).toLocaleString('de-DE') : ''}>
              <BuildIcon src={b.image} />
              <span className="ft-name">{b.name}</span>
              <span className="ft-time">
                {done ? (
                  <>
                    <CheckCircle2 size={14} /> {t('Fertig')}
                  </>
                ) : b.completesAt ? (
                  countdown(b.completesAt, now)
                ) : (
                  '–'
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

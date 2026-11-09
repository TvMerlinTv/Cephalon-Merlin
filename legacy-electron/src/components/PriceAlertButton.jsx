import { useState } from 'react';
import { Bell, BellPlus, Check } from 'lucide-react';
import { addAlert, useAlerts } from '../lib/priceAlerts.js';
import { useT } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';
import '../pages/priceAlerts.css';

/** „Preis-Alarm“ neben den SELL/BUY-Preisen: Bedingung, Zielpreis und (bei Mods) Rang wählen. */
export default function PriceAlertButton({ item, price }) {
  const t = useT();
  const alerts = useAlerts();
  const mine = alerts.filter((a) => a.slug === item.slug);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('wts');
  const [rank, setRank] = useState(0);
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState(false);

  const suggest = (k) => (k === 'wtb' ? price?.wtb : price?.wts) ?? '';
  const toggle = () => {
    if (!open) {
      setTarget(suggest(kind));
      setSaved(false);
    }
    setOpen(!open);
  };
  const pickKind = (k) => {
    setKind(k);
    setTarget(suggest(k));
  };
  const save = () => {
    addAlert({ item, kind, target, rank });
    setSaved(true);
    setTimeout(() => setOpen(false), 900);
  };

  return (
    <span className="pa-wrap">
      <button className={`btn btn-outline pa-btn ${mine.length ? 'has' : ''}`} onClick={toggle} title={t('Benachrichtigen, wenn der Preis eine Grenze erreicht')}>
        <Bell size={13} /> {t('Preis-Alarm')}
        {mine.length > 0 && <span className="pa-count">{mine.length}</span>}
      </button>
      {open && (
        <div className="pa-pop" onClick={(e) => e.stopPropagation()}>
          <div className="seg seg-text">
            <button className={kind === 'wts' ? 'active' : ''} onClick={() => pickKind('wts')} title={t('Wenn ich günstig kaufen will')}>
              {t('Verkaufsangebot ≤ X p')}
            </button>
            <button className={kind === 'wtb' ? 'active' : ''} onClick={() => pickKind('wtb')} title={t('Wenn ich gut verkaufen will')}>
              {t('Kaufgebot ≥ X p')}
            </button>
          </div>
          {item.maxRank > 0 && (
            <div className="seg seg-text">
              <button className={rank === 0 ? 'active' : ''} onClick={() => setRank(0)}>
                {t('Rang 0')}
              </button>
              <button className={rank === item.maxRank ? 'active' : ''} onClick={() => setRank(item.maxRank)}>
                {t('Max (Rang {n})', { n: item.maxRank })}
              </button>
            </div>
          )}
          <label className="pa-target">
            <span>{t('Zielpreis')}</span>
            <input
              type="number"
              min="1"
              value={target}
              autoFocus
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && Number(target) > 0 && save()}
            />
            <Plat />
          </label>
          <button className="btn btn-primary" onClick={save} disabled={!(Number(target) > 0) || saved}>
            {saved ? <Check size={14} /> : <BellPlus size={14} />} {t(saved ? 'Alarm gespeichert' : 'Alarm anlegen')}
          </button>
          <p className="muted small">{t('Wird regelmäßig geprüft (Einstellungen → Benachrichtigungen). Übersicht: Handel → Preis-Alarme.')}</p>
        </div>
      )}
    </span>
  );
}

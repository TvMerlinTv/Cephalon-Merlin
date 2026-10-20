import { useState } from 'react';
import { BellRing, Clock, Trash2, RefreshCw, Power, ExternalLink } from 'lucide-react';
import { useAlerts, removeAlert, toggleAlert, checkAlerts, conditionText, rankText } from '../lib/priceAlerts.js';
import { useSettings } from '../lib/settings.js';
import { openMarket } from '../lib/builds.js';
import { useT } from '../lib/i18n.js';
import { Plat } from '../components/Icons.jsx';
import './priceAlerts.css';

const when = (ts, lang) => (ts ? new Date(ts).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

/** Reiter „Preis-Alarme“ auf der Handel-Seite: alle Alarme mit Status, an/aus und löschen. */
export default function PriceAlerts() {
  const t = useT();
  const s = useSettings();
  const alerts = useAlerts();
  const [busy, setBusy] = useState(false);
  const checkNow = async () => {
    setBusy(true);
    await checkAlerts().catch(() => {});
    setBusy(false);
  };

  return (
    <>
      <div className="toolbar">
        <p className="muted small pa-hint">
          {t('Neue Alarme legst du in den Item-Details über „Preis-Alarm“ an.')}{' '}
          {s.notifyPriceAlerts
            ? t('Geprüft wird alle {n} Minuten.', { n: s.priceAlertMinutes })
            : t('Preis-Alarme sind in den Einstellungen ausgeschaltet.')}
        </p>
        <button className="btn" onClick={checkNow} disabled={busy || !alerts.some((a) => a.enabled)}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} /> {t('Jetzt prüfen')}
        </button>
      </div>
      {alerts.length === 0 ? (
        <div className="empty">{t('Noch keine Preis-Alarme.')}</div>
      ) : (
        <div className="trd-table-wrap">
          <table className="trd-table pa-table">
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Bedingung')}</th>
                <th className="num">{t('Aktueller Preis')}</th>
                <th>{t('Zuletzt geprüft')}</th>
                <th>{t('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className={a.enabled ? '' : 'pa-off'}>
                  <td>
                    <button className="trd-name pa-item" onClick={() => openMarket(a.slug, a.rank)} title={t('Auf der Markt-Seite öffnen')}>
                      {a.thumb && <img src={a.thumb} alt="" />}
                      {a.name}
                      {a.rank != null && <span className="trd-tag">{rankText(a)}</span>}
                    </button>
                  </td>
                  <td>{conditionText(a)}</td>
                  <td className="num">
                    {a.price != null ? (
                      <>
                        {a.price} <Plat />
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="muted">{when(a.checked, s.language)}</td>
                  <td>
                    {!a.enabled ? (
                      <span className="pa-status off">{t('Aus')}</span>
                    ) : a.error ? (
                      <span className="pa-status err" title={a.error}>
                        {t('Fehler')}
                      </span>
                    ) : a.triggered ? (
                      <span className="pa-status hit">
                        <BellRing size={13} /> {t('Ausgelöst')}
                      </span>
                    ) : (
                      <span className="pa-status wait">
                        <Clock size={13} /> {t('Wartet')}
                      </span>
                    )}
                  </td>
                  <td className="pa-actions">
                    <button className="icon-btn" onClick={() => openMarket(a.slug, a.rank)} title={t('Auf der Markt-Seite öffnen')}>
                      <ExternalLink size={15} />
                    </button>
                    <button className={`icon-btn ${a.enabled ? 'pa-on' : ''}`} onClick={() => toggleAlert(a.id)} title={t(a.enabled ? 'Ausschalten' : 'Einschalten')}>
                      <Power size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => removeAlert(a.id)} title={t('Löschen')}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Reiter „Preis-Alarme“ auf der Handel-Seite: alle Alarme mit Status, an/aus und löschen.
import { createSignal, For, Show } from 'solid-js';
import { BellRing, Clock, Trash2, RefreshCw, Power, ExternalLink } from 'lucide-solid';
import { alerts, removeAlert, toggleAlert, checkAlerts, conditionText, rankText } from '../lib/priceAlerts.js';
import { settings } from '../lib/settings.js';
import { openMarket } from './Market.jsx';
import { t } from '../lib/i18n.js';
import { Plat } from '../components/Icons.jsx';
import './priceAlerts.css';

const when = (ts) => (ts ? new Date(ts).toLocaleString(settings.language === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

export default function PriceAlerts() {
  const [busy, setBusy] = createSignal(false);
  const checkNow = async () => {
    setBusy(true);
    await checkAlerts().catch(() => {});
    setBusy(false);
  };
  return (
    <>
      <div class="toolbar">
        <p class="muted small pa-hint">
          {t('Neue Alarme legst du in den Item-Details über „Preis-Alarm“ an.')}{' '}
          {settings.notifyPriceAlerts ? t('Geprüft wird alle {n} Minuten.', { n: settings.priceAlertMinutes }) : t('Preis-Alarme sind in den Einstellungen ausgeschaltet.')}
        </p>
        <button class="btn" onClick={checkNow} disabled={busy() || !alerts().some((a) => a.enabled)}>
          <RefreshCw size={14} class={busy() ? 'spin' : ''} /> {t('Jetzt prüfen')}
        </button>
      </div>
      <Show when={alerts().length} fallback={<div class="empty">{t('Noch keine Preis-Alarme.')}</div>}>
        <div class="trd-table-wrap">
          <table class="trd-table pa-table">
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Bedingung')}</th>
                <th class="num">{t('Aktueller Preis')}</th>
                <th>{t('Zuletzt geprüft')}</th>
                <th>{t('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={alerts()}>
                {(a) => (
                  <tr classList={{ 'pa-off': !a.enabled }}>
                    <td>
                      <button class="trd-name pa-item" onClick={() => openMarket(a.slug, a.rank)} title={t('Auf der Markt-Seite öffnen')}>
                        <Show when={a.thumb}>
                          <img src={a.thumb} alt="" />
                        </Show>
                        {a.name}
                        <Show when={a.rank != null}>
                          <span class="trd-tag">{rankText(a)}</span>
                        </Show>
                      </button>
                    </td>
                    <td>{conditionText(a)}</td>
                    <td class="num">
                      {a.price != null ? (
                        <>
                          {a.price} <Plat />
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td class="muted">{when(a.checked)}</td>
                    <td>
                      {!a.enabled ? (
                        <span class="pa-status off">{t('Aus')}</span>
                      ) : a.error ? (
                        <span class="pa-status err" title={a.error}>
                          {t('Fehler')}
                        </span>
                      ) : a.triggered ? (
                        <span class="pa-status hit">
                          <BellRing size={13} /> {t('Ausgelöst')}
                        </span>
                      ) : (
                        <span class="pa-status wait">
                          <Clock size={13} /> {t('Wartet')}
                        </span>
                      )}
                    </td>
                    <td class="pa-actions">
                      <button class="icon-btn" onClick={() => openMarket(a.slug, a.rank)} title={t('Auf der Markt-Seite öffnen')}>
                        <ExternalLink size={15} />
                      </button>
                      <button class="icon-btn" classList={{ 'pa-on': a.enabled }} onClick={() => toggleAlert(a.id)} title={t(a.enabled ? 'Ausschalten' : 'Einschalten')}>
                        <Power size={15} />
                      </button>
                      <button class="icon-btn" onClick={() => removeAlert(a.id)} title={t('Löschen')}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </>
  );
}

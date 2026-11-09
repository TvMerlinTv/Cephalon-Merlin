// „Preis-Alarm“ neben den SELL/BUY-Preisen: Bedingung, Zielpreis und (bei Mods) Rang wählen.
import { createSignal, Show } from 'solid-js';
import { Bell, BellPlus, Check } from 'lucide-solid';
import { addAlert, alerts } from '../lib/priceAlerts.js';
import { t } from '../lib/i18n.js';
import { Plat } from './Icons.jsx';
import '../pages/priceAlerts.css';

export default function PriceAlertButton(props) {
  const mine = () => alerts().filter((a) => a.slug === props.item.slug);
  const [open, setOpen] = createSignal(false);
  const [kind, setKind] = createSignal('wts');
  const [rank, setRank] = createSignal(0);
  const [target, setTarget] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  const suggest = (k) => (k === 'wtb' ? props.price?.wtb : props.price?.wts) ?? '';
  const toggle = () => {
    if (!open()) {
      setTarget(suggest(kind()));
      setSaved(false);
    }
    setOpen(!open());
  };
  const pickKind = (k) => {
    setKind(k);
    setTarget(suggest(k));
  };
  const save = () => {
    addAlert({ item: props.item, kind: kind(), target: target(), rank: rank() }).catch(() => {});
    setSaved(true);
    setTimeout(() => setOpen(false), 900);
  };
  return (
    <span class="pa-wrap">
      <button class="btn btn-outline pa-btn" classList={{ has: mine().length > 0 }} onClick={toggle} title={t('Benachrichtigen, wenn der Preis eine Grenze erreicht')}>
        <Bell size={13} /> {t('Preis-Alarm')}
        <Show when={mine().length > 0}>
          <span class="pa-count">{mine().length}</span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="pa-pop" onClick={(e) => e.stopPropagation()}>
          <div class="seg seg-text">
            <button classList={{ active: kind() === 'wts' }} onClick={() => pickKind('wts')} title={t('Wenn ich günstig kaufen will')}>
              {t('Verkaufsangebot ≤ X p')}
            </button>
            <button classList={{ active: kind() === 'wtb' }} onClick={() => pickKind('wtb')} title={t('Wenn ich gut verkaufen will')}>
              {t('Kaufgebot ≥ X p')}
            </button>
          </div>
          <Show when={props.item.maxRank > 0}>
            <div class="seg seg-text">
              <button classList={{ active: rank() === 0 }} onClick={() => setRank(0)}>
                {t('Rang 0')}
              </button>
              <button classList={{ active: rank() === props.item.maxRank }} onClick={() => setRank(props.item.maxRank)}>
                {t('Max (Rang {n})', { n: props.item.maxRank })}
              </button>
            </div>
          </Show>
          <label class="pa-target">
            <span>{t('Zielpreis')}</span>
            <input
              type="number"
              min="1"
              value={target()}
              ref={(el) => setTimeout(() => el.focus())}
              onInput={(e) => setTarget(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && Number(target()) > 0 && save()}
            />
            <Plat />
          </label>
          <button class="btn btn-primary" onClick={save} disabled={!(Number(target()) > 0) || saved()}>
            {saved() ? <Check size={14} /> : <BellPlus size={14} />} {t(saved() ? 'Alarm gespeichert' : 'Alarm anlegen')}
          </button>
          <p class="muted small">{t('Wird regelmäßig geprüft (Einstellungen → Benachrichtigungen). Übersicht: Handel → Preis-Alarme.')}</p>
        </div>
      </Show>
    </span>
  );
}

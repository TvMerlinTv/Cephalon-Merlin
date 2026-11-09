// Preis-Alarme: Liste kommt aus dem Rust-Teil (alerts.json), der sie auch regelmäßig prüft und meldet.
import { createSignal } from 'solid-js';
import { call, isTauri, on } from './ipc.js';
import { t } from './i18n.js';

const [alerts, setAlerts] = createSignal([]);
export { alerts };
if (isTauri) {
  call('alerts_list').then(setAlerts).catch(() => {});
  on('alerts', setAlerts);
}

export const addAlert = ({ item, kind, target, rank }) =>
  call('alerts_add', { item: { slug: item.slug, name: item.name, thumb: item.thumb ?? null, maxRank: item.maxRank ?? null }, kind, target: Number(target), rank: Number(rank) || 0 });
export const removeAlert = (id) => call('alerts_remove', { id });
export const toggleAlert = (id) => call('alerts_toggle', { id });
export const checkAlerts = () => call('alerts_check');

/** Bedingung als Text, z. B. „Verkaufsangebot ≤ 90p“. */
export const conditionText = (a) => (a.kind === 'wtb' ? t('Kaufgebot ≥ {n}p', { n: a.target }) : t('Verkaufsangebot ≤ {n}p', { n: a.target }));
export const rankText = (a) => (a.rank == null ? '' : a.rank === a.maxRank ? t('Max (Rang {n})', { n: a.rank }) : t('Rang {n}', { n: a.rank }));

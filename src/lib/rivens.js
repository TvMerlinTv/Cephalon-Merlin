// Riven-Mods: Werte aus dem UpgradeFingerprint ausrechnen und mit warframe.market verknüpfen.
// Wert bei Max-Rang = Basis × 90 × Disposition × Stat-Faktor × (0,9 … 1,1 je nach Würfelwurf).
// Basiswerte aus dem Public Export (rivenData.json), Dispositionen von warframe.market (Rust-Cache, 24 h).
import { call } from './ipc.js';
import DATA from './rivenData.json';

export const RIVEN_TYPES = [
  { id: 'LotusRifle', label: 'Gewehr' },
  { id: 'LotusShotgun', label: 'Schrotflinte' },
  { id: 'LotusPistol', label: 'Pistole' },
  { id: 'PlayerMeleeWeapon', label: 'Nahkampf' },
  { id: 'LotusModularMelee', label: 'Zaw' },
  { id: 'LotusModularPistol', label: 'Kitgun' },
  { id: 'LotusArchgun', label: 'Arch-Gun' },
];
export const RAW_LABELS = {
  Rifle: 'Gewehr', Shotgun: 'Schrotflinte', Pistol: 'Pistole', Melee: 'Nahkampf',
  ModularMelee: 'Zaw', ModularPistol: 'Kitgun', Archgun: 'Arch-Gun', SentinelWeapon: 'Begleiter-Waffe',
};
export const POLARITIES = { AP_ATTACK: 'Madurai', AP_DEFENSE: 'Vazarin', AP_TACTIC: 'Naramon', AP_POWER: 'Zenurik' };

// Kuva pro Umwürfeln; ab dem 10. Mal immer 3500
const KUVA = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150];
export const nextRollKuva = (rerolls) => KUVA[rerolls] ?? 3500;
export const spentKuva = (rerolls) => Array.from({ length: rerolls }, (_, i) => nextRollKuva(i)).reduce((a, b) => a + b, 0);

// Stärke von Buffs/Curse je nach Anzahl (2 oder 3 Buffs, mit oder ohne Curse)
const FACTORS = { 20: [0.99, 0], 21: [1.2375, 0.495], 30: [0.75, 0], 31: [0.9375, 0.75] };
const marketTag = (tag) => tag.replace('WeaponMeleeFaction', 'WeaponFaction').replace('WeaponMeleeDamageMod', 'WeaponDamageAmountMod');

/** Disposition 0,5 … 1,55 -> 1 … 5 Punkte (wie im Spiel). */
export function dispositionDots(d) {
  if (d == null) return 0;
  if (d < 0.7) return 1;
  if (d < 0.9) return 2;
  if (d <= 1.1) return 3;
  if (d <= 1.3) return 4;
  return 5;
}

/** { weapons: Map(gameRef → Waffe), attributes: Map(Tag → Stat) } */
export async function loadRivenMeta(language) {
  const m = await call('riven_meta', { language });
  return { weapons: new Map(m.weapons.map((w) => [w.gameRef, w])), attributes: new Map(m.attributes.map((a) => [a.gameRef, a])) };
}

const nameFromPath = (p) => (p ?? '').split('/').pop().replace(/([a-z])([A-Z])/g, '$1 $2');

function formatValue(v, unit) {
  if (unit === 'multiply') return `x${(1 + v).toFixed(2)}`;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  if (unit === 'percent') return `${sign}${(abs * 100).toFixed(1)}%`;
  if (unit === 'seconds') return `${sign}${abs.toFixed(1)}s`;
  return `${sign}${abs.toFixed(1)}`;
}

function unitFromText(text) {
  if (/Damage to /.test(text)) return 'multiply';
  if (/\|val\|%/.test(text)) return 'percent';
  if (/\|val\|s/.test(text)) return 'seconds';
  return null;
}

/** Riven aus dem Inventar -> alles, was die Oberfläche anzeigt. */
export function describeRiven(r, meta) {
  const weapon = (r.compat && meta?.weapons.get(r.compat)) || null;
  const disposition = weapon?.disposition ?? null;
  const table = DATA.stats[r.type] ?? {};
  const [buffF, curseF] = FACTORS[`${r.buffs.length}${r.curses.length}`] ?? [1, 1];
  const stat = (s, curse) => {
    const info = table[s.tag];
    const attr = meta?.attributes.get(marketTag(s.tag));
    const unit = attr?.unit ?? (info ? unitFromText(info.text) : null);
    let value = null;
    if (info && disposition != null) {
      value = info.base * 90 * disposition * (curse ? curseF : buffF) * (0.9 + 0.2 * s.roll);
      if (curse) value = -value;
    }
    return {
      tag: s.tag,
      slug: attr?.slug ?? null,
      label: attr?.name ?? (info ? info.text.replace(/\|val\|[%s]?/, '').trim() : nameFromPath(s.tag)),
      text: value == null ? '?' : formatValue(value, unit),
      curse,
      roll: s.roll,
    };
  };
  const stats = [...r.buffs.map((s) => stat(s, false)), ...r.curses.map((s) => stat(s, true))];
  const rolls = stats.map((s) => s.roll);
  return {
    ...r,
    weapon: weapon?.name ?? (r.compat ? nameFromPath(r.compat) : null),
    slug: weapon?.slug ?? null,
    thumb: weapon?.thumb ?? null,
    disposition,
    dots: dispositionDots(disposition),
    typeLabel: RIVEN_TYPES.find((x) => x.id === r.type)?.label ?? r.type,
    polarityName: POLARITIES[r.polarity] ?? null,
    stats,
    quality: rolls.length ? rolls.reduce((a, b) => a + b, 0) / rolls.length : null,
  };
}

/** Text der Herausforderung eines verschleierten Rivens (Spieltext, Englisch). */
export function challengeText(c) {
  if (!c) return '';
  const T = DATA.challenges;
  const comp = c.complication;
  let text = (comp && T[`${c.type}_${comp}`]) || (c.required <= 1 && T[`${c.type}_Single_Description`]) || T[`${c.type}_Description`] || nameFromPath(c.type);
  text = text.replace(/\|COUNT\|/g, c.required);
  if (comp && !T[`${c.type}_${comp}`] && T[`Complication_${comp}`]) text += ` ${T[`Complication_${comp}`]}`;
  return text;
}

/** Fehlertext aus dem Rust-Teil: "HTTP 429 für … (retryAt 1794…)" -> { busy, retryAt, message } */
export function parseMarketError(e) {
  const msg = String(e?.message ?? e);
  const at = /\(retryAt (\d+)\)/.exec(msg);
  const status = /HTTP (\d{3})/.exec(msg);
  const s = status ? Number(status[1]) : null;
  return { busy: s === 429 || (s >= 500 && s < 600), retryAt: at ? Number(at[1]) : null, aborted: msg === 'Abgebrochen', message: msg.replace(/ \(retryAt \d+\)/, '') };
}

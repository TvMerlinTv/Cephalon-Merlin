// Riven-Mods: Werte aus dem UpgradeFingerprint ausrechnen und mit warframe.market verknüpfen.
//
// Wert bei Max-Rang = Basis × 90 × Disposition × Stat-Faktor × (0,9 … 1,1 je nach Würfelwurf)
// Basiswerte stammen aus dem Public Export (rivenData.json), Dispositionen live von warframe.market.
import { useEffect, useState } from 'react';
import { load, marketGet, MARKET_ASSETS, save } from './api.js';
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
// Ungeöffnete Rivens (RawUpgrades) heißen etwas anders
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

// Nahkampf-Rivens nutzen eigene Tags für dieselben Stats wie auf warframe.market
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

// ---------- Daten von warframe.market (Waffen mit Disposition, Stat-Namen) ----------
const META_TTL = 24 * 60 * 60 * 1000;
const metaPromises = {};

function loadMeta(language) {
  const key = `td.rivenmeta.v1.${language}`;
  const cached = load(key, null);
  if (cached && Date.now() - cached.ts < META_TTL) return Promise.resolve(cached);
  return Promise.all([marketGet('/v2/riven/weapons', language), marketGet('/v2/riven/attributes', language)])
    .then(([w, a]) => {
      const name = (x) => x.i18n?.[language]?.name ?? x.i18n?.en?.name ?? x.slug;
      const meta = {
        ts: Date.now(),
        weapons: w.data.map((x) => ({
          gameRef: x.gameRef,
          slug: x.slug,
          name: name(x),
          thumb: x.i18n?.en?.thumb ? MARKET_ASSETS + x.i18n.en.thumb : null,
          disposition: x.disposition ?? null,
          mr: x.reqMasteryRank ?? null,
        })),
        attributes: a.data.map((x) => ({ gameRef: x.gameRef, slug: x.slug, name: name(x), unit: x.unit ?? null })),
      };
      save(key, meta);
      return meta;
    })
    .catch((e) => {
      if (cached) return cached;
      throw e;
    });
}

/** { weapons: Map(gameRef → Waffe), attributes: Map(Tag → Stat) } oder null während des Ladens. */
export function useRivenMeta(language) {
  const [state, setState] = useState({ meta: null, error: null });
  useEffect(() => {
    let alive = true;
    metaPromises[language] ??= loadMeta(language).catch((e) => {
      delete metaPromises[language];
      throw e;
    });
    metaPromises[language]
      .then((m) => {
        if (!alive) return;
        setState({
          meta: {
            weapons: new Map(m.weapons.map((w) => [w.gameRef, w])),
            attributes: new Map(m.attributes.map((a) => [a.gameRef, a])),
          },
          error: null,
        });
      })
      .catch((e) => alive && setState({ meta: null, error: e.message ?? String(e) }));
    return () => {
      alive = false;
    };
  }, [language]);
  return state;
}

// ---------- Werte ausrechnen ----------
// "/Lotus/Weapons/Tenno/Bows/AntlerBow/AntlerBow" -> "Antler Bow" (falls warframe.market die Waffe nicht kennt)
const nameFromPath = (p) => (p ?? '').split('/').pop().replace(/([a-z])([A-Z])/g, '$1 $2');

function formatValue(v, unit) {
  if (unit === 'multiply') return `x${(1 + v).toFixed(2)}`;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  if (unit === 'percent') return `${sign}${(abs * 100).toFixed(1)}%`;
  if (unit === 'seconds') return `${sign}${abs.toFixed(1)}s`;
  return `${sign}${abs.toFixed(1)}`;
}

// Einheit aus dem Spieltext, falls warframe.market den Stat nicht kennt
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
      if (curse) value = -value; // Curse kehrt den Stat um (Schaden −, Rückstoß + …)
    }
    return {
      tag: s.tag,
      slug: attr?.slug ?? null,
      label: attr?.name ?? (info ? info.text.replace(/\|val\|[%s]?/, '').trim() : nameFromPath(s.tag)),
      text: value == null ? '?' : formatValue(value, unit),
      // Gut für den Spieler? Rückstoß ist z. B. als Buff negativ
      good: !curse,
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
    typeLabel: RIVEN_TYPES.find((t) => t.id === r.type)?.label ?? r.type,
    polarityName: POLARITIES[r.polarity] ?? null,
    stats,
    // Durchschnittlicher Würfelwurf aller Stats (0 = schlechtester, 1 = bester möglicher Wert)
    quality: rolls.length ? rolls.reduce((a, b) => a + b, 0) / rolls.length : null,
  };
}

/** Text der Herausforderung eines verschleierten Rivens (Spieltext, Englisch). */
export function challengeText(c) {
  if (!c) return '';
  const T = DATA.challenges;
  const comp = c.complication;
  let text =
    (comp && T[`${c.type}_${comp}`]) ||
    (c.required <= 1 && T[`${c.type}_Single_Description`]) ||
    T[`${c.type}_Description`] ||
    nameFromPath(c.type);
  text = text.replace(/\|COUNT\|/g, c.required);
  if (comp && !T[`${c.type}_${comp}`] && T[`Complication_${comp}`]) text += ` ${T[`Complication_${comp}`]}`;
  return text;
}

// ---------- Preise (Auktionen auf warframe.market) ----------
// Die Auktionssuche ist stark begrenzt (ca. 10 Anfragen/Minute, siehe api.js) – darum
// zwischenspeichern und, wo möglich, „gleiche Stats“ lokal aus der Waffenliste filtern.
const AUCTION_TTL = 15 * 60 * 1000;
// Mehr liefert die Suche nie; ist die Liste voll, fehlen teurere Angebote
const AUCTION_LIMIT = 500;
const auctionCache = new Map();

function searchAuctions(weaponSlug, stats, signal) {
  const key = `${weaponSlug}|${stats}`;
  const hit = auctionCache.get(key);
  if (hit && Date.now() - hit.ts < AUCTION_TTL) return hit.promise;
  const q = `type=riven&weapon_url_name=${encodeURIComponent(weaponSlug)}&sort_by=price_asc${stats ? `&positive_stats=${encodeURIComponent(stats)}` : ''}`;
  let settled = false;
  const promise = marketGet(`/v1/auctions/search?${q}`, undefined, { signal })
    .then((r) => {
      const raw = r.payload?.auctions ?? [];
      const list = raw
        .filter((a) => a.buyout_price && !a.closed && a.visible)
        .sort((a, b) => a.buyout_price - b.buyout_price)
        .map((a) => ({
          id: a.id,
          price: a.buyout_price,
          seller: a.owner?.ingame_name ?? '?',
          status: a.owner?.status ?? 'offline',
          rerolls: a.item?.re_rolls ?? 0,
          name: a.item?.name ?? '',
          attributes: a.item?.attributes ?? [],
        }));
      list.complete = raw.length < AUCTION_LIMIT;
      return list;
    })
    .finally(() => {
      settled = true;
    });
  const drop = () => auctionCache.get(key)?.promise === promise && auctionCache.delete(key);
  promise.catch(drop);
  // Weggeklickt, bevor die Anfrage dran war: sofort vergessen, damit ein erneuter Klick neu fragt
  signal?.addEventListener('abort', () => !settled && drop());
  auctionCache.set(key, { ts: Date.now(), promise });
  return promise;
}

/** Günstigste Sofortkauf-Angebote einer Waffe, optional nur mit diesen positiven Stats. */
export async function getRivenAuctions(weaponSlug, positive = [], { signal } = {}) {
  const stats = [...positive].sort().join(',');
  const all = await searchAuctions(weaponSlug, '', signal);
  if (!stats) return all;
  // Vollständige Liste: lokal filtern statt einer zweiten Anfrage
  if (all.complete) {
    return all.filter((a) => positive.every((s) => a.attributes.some((at) => at.positive && at.url_name === s)));
  }
  return searchAuctions(weaponSlug, stats, signal);
}

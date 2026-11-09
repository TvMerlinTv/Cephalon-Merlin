// Weltstatus direkt von Warframe (statt warframestat.us, das zeitweise stundenlang hängen bleibt):
// Spalten, Void-Stürme, Baro, die Zyklen von Erde, Cetus, Orb Vallis und Cambion Drift,
// außerdem Sortie, Archon-Jagd und Nightwave.
const path = require('node:path');
const fs = require('node:fs/promises');

const WORLDSTATE = 'https://api.warframe.com/cdn/worldState.php';
// Namen für Knoten ("SolNode84" -> "Nereid (Neptune)") und Missionstypen (WFCD, Open Source)
const NAMES = 'https://cdn.jsdelivr.net/npm/warframe-worldstate-data@3.18.1/dist/data/';
const NAMES_TTL = 7 * 24 * 60 * 60 * 1000;
const UA = { 'User-Agent': 'CephalonMerlin/0.1' };

const TIERS = { VoidT1: 'Lith', VoidT2: 'Meso', VoidT3: 'Neo', VoidT4: 'Axi', VoidT5: 'Requiem', VoidT6: 'Omnia' };
const TIER_NUM = { VoidT1: 1, VoidT2: 2, VoidT3: 3, VoidT4: 4, VoidT5: 5, VoidT6: 6 };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res.json();
}

let namesPromise = null;
function loadNames(dataDir) {
  namesPromise ??= (async () => {
    const file = path.join(dataDir, 'worldstate-names.json');
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Date.now() - cached.ts < NAMES_TTL && cached.sortie && cached.challenges) return cached;
    } catch {
      /* noch kein Cache */
    }
    try {
      const [nodes, missions, sortieData, languages] = await Promise.all(
        ['solNodes', 'missionTypes', 'sortieData', 'languages'].map((n) => getJson(`${NAMES}${n}.json`)),
      );
      // Sortie: Bosse + Modifikatoren; Nightwave: nur die Herausforderungen aus languages.json (sonst ~700 KB)
      const sortie = { bosses: sortieData.bosses, modifiers: sortieData.modifierTypes, descriptions: sortieData.modifierDescriptions };
      const challenges = {};
      for (const [k, v] of Object.entries(languages)) if (/\/challenges\/seasons\//i.test(k)) challenges[k.toLowerCase()] = v;
      const names = { ts: Date.now(), nodes, missions, sortie, challenges };
      await fs.writeFile(file, JSON.stringify(names), 'utf8').catch(() => {});
      return names;
    } catch (e) {
      // Offline: alten Cache nehmen, sonst ohne Namen weiter (dann stehen die Roh-IDs da)
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        namesPromise = null;
        return { nodes: {}, missions: {}, sortie: {}, challenges: {} };
      }
    }
  })();
  return namesPromise;
}

const ms = (d) => Number(d?.$date?.$numberLong ?? 0);
const iso = (t) => new Date(t).toISOString();

// ---- Zyklen ----
// Erde: 4 Std. Tag, 4 Std. Nacht, Wechsel zu jeder vollen 4. UTC-Stunde (00:00 beginnt ein Tag)
function earthCycle(now) {
  const len = 4 * 3600e3;
  const slot = Math.floor(now / len);
  return { state: slot % 2 === 0 ? 'day' : 'night', activation: iso(slot * len), expiry: iso((slot + 1) * len) };
}

// Cetus: 150 Min. (100 Tag + 50 Nacht); das Cetus-Kopfgeld endet genau mit der Nacht.
function cetusCycle(bountyEnd, now) {
  const len = 150 * 60e3;
  const night = 50 * 60e3;
  let end = bountyEnd || now;
  while (end <= now) end += len; // Kopfgeld schon abgelaufen? Weiterrechnen
  while (end - len > now) end -= len;
  const nightStart = end - night;
  return now < nightStart
    ? { state: 'day', activation: iso(end - len), expiry: iso(nightStart) }
    : { state: 'night', activation: iso(nightStart), expiry: iso(end) };
}

// Orb Vallis: 1600 s (400 s warm, 1200 s kalt), gleichbleibend seit dem 10.11.2018 08:13:48 UTC
function vallisCycle(now) {
  const start = Date.UTC(2018, 10, 10, 8, 13, 48);
  const loop = 1600e3;
  const warm = 400e3;
  const loopStart = now - ((now - start) % loop);
  return now - loopStart < warm
    ? { state: 'warm', activation: iso(loopStart), expiry: iso(loopStart + warm) }
    : { state: 'cold', activation: iso(loopStart + warm), expiry: iso(loopStart + loop) };
}

// Cambion Drift: folgt Cetus (Tag = Fass, Nacht = Vome)
const cambionCycle = (cetus) => ({ ...cetus, state: cetus.state === 'day' ? 'fass' : 'vome' });

// ---- Sortie, Archon-Jagd, Nightwave ----
const ARCHON_SHARD = { SORTIE_BOSS_AMAR: 'crimson', SORTIE_BOSS_NIRA: 'amber', SORTIE_BOSS_BOREAL: 'azure' };
const NW_STANDING = { daily: 1000, weekly: 4500, elite: 7000 };
// "SORTIE_MODIFIER_LOW_ENERGY" -> "Low Energy", "SeasonWeeklyHardGoingDown" -> "Going Down" (falls kein Name bekannt)
const humanize = (s, prefix) =>
  String(s ?? '')
    .replace(prefix, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function sortieInfo(s, names, mission, node) {
  if (!s) return null;
  const boss = names.sortie?.bosses?.[s.Boss];
  return {
    id: s._id?.$oid ?? String(ms(s.Activation)),
    boss: boss?.name ?? humanize(s.Boss, 'SORTIE_BOSS_'),
    faction: boss?.faction ?? '',
    activation: iso(ms(s.Activation)),
    expiry: iso(ms(s.Expiry)),
    missions: (s.Variants ?? []).map((v) => ({
      missionType: mission(v.missionType, v.node),
      node: node(v.node),
      modifier: names.sortie?.modifiers?.[v.modifierType] ?? humanize(v.modifierType, 'SORTIE_MODIFIER_'),
      modifierDesc: names.sortie?.descriptions?.[v.modifierType] ?? '',
    })),
  };
}

function archonInfo(a, names, mission, node) {
  if (!a) return null;
  return {
    id: a._id?.$oid ?? String(ms(a.Activation)),
    boss: names.sortie?.bosses?.[a.Boss]?.name ?? humanize(a.Boss, 'SORTIE_BOSS_'),
    shard: ARCHON_SHARD[a.Boss] ?? null,
    activation: iso(ms(a.Activation)),
    expiry: iso(ms(a.Expiry)),
    missions: (a.Missions ?? []).map((m) => ({ missionType: mission(m.missionType, m.node), node: node(m.node) })),
  };
}

function nightwaveInfo(n, names, now) {
  if (!n) return null;
  const challenges = (n.ActiveChallenges ?? [])
    .filter((c) => ms(c.Expiry) > now)
    .map((c) => {
      const kind = c.Daily ? 'daily' : /WeeklyHard/i.test(c.Challenge) ? 'elite' : 'weekly';
      const tr = names.challenges?.[String(c.Challenge).toLowerCase()];
      return {
        id: c._id?.$oid ?? c.Challenge,
        kind,
        title: tr?.value ?? humanize(String(c.Challenge).split('/').pop(), /^Season(Daily|WeeklyHard|Weekly)(Permanent)?/),
        desc: tr?.desc ?? '',
        standing: NW_STANDING[kind],
        activation: iso(ms(c.Activation)),
        expiry: iso(ms(c.Expiry)),
      };
    });
  return { season: n.Season, phase: n.Phase, tag: n.AffiliationTag, activation: iso(ms(n.Activation)), expiry: iso(ms(n.Expiry)), challenges };
}

async function getWorldState(dataDir) {
  const [ws, names] = await Promise.all([getJson(WORLDSTATE), loadNames(dataDir)]);
  const now = Date.now();
  const node = (id) => names.nodes[id]?.value ?? id;
  const nodeType = (id) => names.nodes[id]?.type ?? '';
  const mission = (mt, id) => names.missions[mt]?.value || nodeType(id) || mt;

  const fissures = (ws.ActiveMissions ?? [])
    .filter((m) => TIERS[m.Modifier] && ms(m.Expiry) > now)
    .map((m) => ({
      id: m._id?.$oid ?? `${m.Node}${ms(m.Activation)}`,
      tier: TIERS[m.Modifier],
      tierNum: TIER_NUM[m.Modifier],
      missionType: mission(m.MissionType, m.Node),
      node: node(m.Node),
      isHard: !!m.Hard,
      isStorm: false,
      activation: iso(ms(m.Activation)),
      expiry: iso(ms(m.Expiry)),
    }));
  const storms = (ws.VoidStorms ?? [])
    .filter((m) => TIERS[m.ActiveMissionTier] && ms(m.Expiry) > now)
    .map((m) => ({
      id: m._id?.$oid ?? `${m.Node}${ms(m.Activation)}`,
      tier: TIERS[m.ActiveMissionTier],
      tierNum: TIER_NUM[m.ActiveMissionTier],
      missionType: nodeType(m.Node) || 'Railjack',
      node: node(m.Node),
      isHard: false,
      isStorm: true,
      activation: iso(ms(m.Activation)),
      expiry: iso(ms(m.Expiry)),
    }));

  const bounty = (ws.SyndicateMissions ?? []).find((s) => s.Tag === 'CetusSyndicate');
  const cetus = cetusCycle(ms(bounty?.Expiry), now);
  const trader = (ws.VoidTraders ?? [])[0];

  return {
    time: iso((ws.Time ?? now / 1000) * 1000),
    earth: earthCycle(now),
    cetus,
    vallis: vallisCycle(now),
    cambion: cambionCycle(cetus),
    baro: trader ? { activation: iso(ms(trader.Activation)), expiry: iso(ms(trader.Expiry)), location: node(trader.Node) } : null,
    fissures: [...fissures, ...storms],
    sortie: sortieInfo((ws.Sorties ?? []).find((s) => ms(s.Expiry) > now), names, mission, node),
    archon: archonInfo((ws.LiteSorties ?? []).find((s) => ms(s.Expiry) > now), names, mission, node),
    nightwave: ms(ws.SeasonInfo?.Expiry) > now ? nightwaveInfo(ws.SeasonInfo, names, now) : null,
  };
}

module.exports = { getWorldState, earthCycle, cetusCycle, vallisCycle };

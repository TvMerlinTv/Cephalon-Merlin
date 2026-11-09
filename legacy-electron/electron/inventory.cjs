// Macht aus der rohen inventory.php-Antwort eine kompakte Zusammenfassung für die UI.

// Ausrüstung, die Mastery gibt (eigene Exemplare).
const GEAR_KEYS = [
  'Suits', 'LongGuns', 'Pistols', 'Melee', 'SpaceSuits', 'SpaceGuns', 'SpaceMelee',
  'Sentinels', 'SentinelWeapons', 'KubrowPets', 'MoaPets', 'MechSuits', 'Hoverboards',
  'OperatorAmps', 'CrewShipWeapons', 'Horses', 'DataKnives', 'Motorcycles',
];

// Relikte liegen im Inventar mit Veredelungsstufe vor (…Bronze = intakt);
// warframe.market kennt nur das Basis-Relikt.
function normalizeType(type) {
  if (type.includes('/Projections/')) return type.replace(/(Bronze|Silver|Gold|Platinum)$/, '');
  return type;
}

const REFINEMENTS = { Bronze: 'intact', Silver: 'exceptional', Gold: 'flawless', Platinum: 'radiant' };

function summarizeInventory(inv, syncedAt, source) {
  const counts = {};
  // Relikte nach Veredelung: { "/Lotus/…/T4VoidProjectionE": { intact: 3, radiant: 1 } }
  const relics = {};
  const add = (type, n) => {
    const t = normalizeType(type);
    counts[t] = (counts[t] ?? 0) + n;
    if (t !== type || type.includes('/Projections/')) {
      const ref = REFINEMENTS[type.slice(t.length)] ?? 'intact';
      relics[t] ??= {};
      relics[t][ref] = (relics[t][ref] ?? 0) + n;
    }
  };

  for (const key of ['MiscItems', 'Recipes', 'RawUpgrades']) {
    for (const e of inv[key] ?? []) if (e.ItemType) add(e.ItemType, e.ItemCount ?? 1);
  }
  // Gerankte Mods/Arcanes sind einzelne Einträge; Rivens (Randomized) gehören auf die Riven-Seite.
  const rivenList = [];
  // Höchster Rang je Mod/Arcane (für die Builds-Seite: „hast du, aber erst Rang 7/10“)
  const modRanks = {};
  for (const e of inv.Upgrades ?? []) {
    if (!e.ItemType) continue;
    if (e.ItemType.includes('/Randomized/')) rivenList.push(parseRiven(e));
    else {
      add(e.ItemType, 1);
      let lvl = 0;
      try {
        lvl = JSON.parse(e.UpgradeFingerprint ?? '{}').lvl ?? 0;
      } catch {
        /* kein Fingerabdruck */
      }
      modRanks[e.ItemType] = Math.max(modRanks[e.ItemType] ?? 0, lvl);
    }
  }
  const rivens = rivenList.length;
  // Noch nicht geöffnete (verschleierte) Rivens liegen als Stückzahl unter RawUpgrades
  const rivenRaw = {};
  for (const e of inv.RawUpgrades ?? []) {
    if (e.ItemType?.includes('/Randomized/')) rivenRaw[riveType(e.ItemType)] = e.ItemCount ?? 1;
  }

  const xp = {};
  for (const e of inv.XPInfo ?? []) xp[e.ItemType] = e.XP ?? 0;

  const owned = {};
  for (const key of GEAR_KEYS) {
    for (const e of inv[key] ?? []) {
      if (!e.ItemType) continue;
      owned[e.ItemType] = (owned[e.ItemType] ?? 0) + 1;
      if (e.XP) xp[e.ItemType] = Math.max(xp[e.ItemType] ?? 0, e.XP);
    }
  }

  return {
    syncedAt,
    source,
    player: {
      mr: inv.PlayerLevel ?? null,
      platinum: inv.PremiumCredits ?? null,
      credits: inv.RegularCredits ?? null,
      endo: inv.FusionPoints ?? null,
      ducats: counts['/Lotus/Types/Items/MiscItems/PrimeBucks'] ?? 0,
      rivens,
    },
    counts,
    modRanks,
    relics,
    xp,
    owned,
    rivens: { list: rivenList, raw: rivenRaw, slots: (inv.RandomModBin?.Slots ?? 0) + (inv.RandomModBin?.Extra ?? 0) },
    foundry: parseFoundry(inv.PendingRecipes),
  };
}

// Foundry: laufende Bauaufträge. Blaupause -> Ergebnis über electron/recipeData.json
// (build/make-recipe-data.cjs); unbekannte (neue) Blaupausen bekommen einen Namen aus dem Pfad.
let recipeData = null;
const FOUNDRY_IMG = 'https://cdn.warframestat.us/img/';
function parseFoundry(pending) {
  if (!Array.isArray(pending) || !pending.length) return [];
  if (!recipeData) {
    try {
      recipeData = require('./recipeData.json');
    } catch {
      recipeData = {};
    }
  }
  return pending
    .filter((e) => e?.ItemType)
    .map((e) => {
      const d = e.CompletionDate?.$date;
      const ms = Number(d?.$numberLong ?? d ?? e.CompletionDate ?? 0);
      const [item, name, image] = recipeData[e.ItemType] ?? [];
      return {
        recipe: e.ItemType,
        item: item ?? null,
        name: name ?? e.ItemType.split('/').pop().replace(/Blueprint$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
        image: image ? FOUNDRY_IMG + image : null,
        completesAt: Number.isFinite(ms) && ms > 0 ? ms : null,
      };
    })
    .sort((a, b) => (a.completesAt ?? Infinity) - (b.completesAt ?? Infinity));
}

// ".../Randomized/LotusRifleRandomModRare" -> "LotusRifle", ".../RawRifleRandomMod" -> "Rifle"
function riveType(itemType) {
  return itemType.split('/').pop().replace(/RandomMod(Rare)?$/, '').replace(/^Raw/, '');
}

// Werte im UpgradeFingerprint: 0 … 0x3FFFFFFF  ->  Würfelergebnis 0 … 1 (entspricht 90 % … 110 %)
const ROLL_MAX = 0x3fffffff;
function parseRiven(e) {
  let f = {};
  try {
    f = JSON.parse(e.UpgradeFingerprint ?? '{}');
  } catch {
    /* kaputter Eintrag: als leeres Riven zeigen */
  }
  const stat = (b) => ({ tag: b.Tag, roll: Math.min(1, Math.max(0, (b.Value ?? 0) / ROLL_MAX)) });
  const c = f.challenge;
  return {
    id: e.ItemId?.$oid ?? null,
    type: riveType(e.ItemType),
    compat: f.compat ?? null,
    rank: f.lvl ?? 0,
    mr: f.lvlReq ?? null,
    rerolls: f.rerolls ?? 0,
    polarity: f.pol ?? null,
    buffs: (f.buffs ?? []).map(stat),
    curses: (f.curses ?? []).map(stat),
    challenge: c
      ? { type: c.Type?.split('/').pop() ?? '', progress: c.Progress ?? 0, required: c.Required ?? 1, complication: c.Complication?.split('/').pop() ?? null }
      : null,
  };
}

module.exports = { summarizeInventory };

// Baut aus WFCD/warframe-items (Open Source) eine kompakte Liste aller Mastery-Items
// mit Bauteilen und Fundorten. Wird 7 Tage im userData-Ordner zwischengespeichert.
const path = require('node:path');
const fs = require('node:fs/promises');

const CDN = 'https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/';
const IMG = 'https://cdn.warframestat.us/img/';
const TTL = 7 * 24 * 60 * 60 * 1000;
const VERSION = 5;

// [Datei, Kategorie in der UI, Warframe-artig? (doppelte XP pro Rang)]
const CATEGORIES = [
  ['Warframes', 'Warframes', true],
  ['Primary', 'Primär', false],
  ['Secondary', 'Sekundär', false],
  ['Melee', 'Nahkampf', false],
  ['Archwing', 'Archwing', true],
  ['Arch-Gun', 'Arch-Gun', false],
  ['Arch-Melee', 'Arch-Melee', false],
  ['Sentinels', 'Begleiter', true],
  ['Pets', 'Begleiter', true],
  ['SentinelWeapons', 'Begleiter-Waffen', false],
];

async function getJson(file) {
  const res = await fetch(CDN + file, { headers: { 'User-Agent': 'CephalonMerlin/0.1' } });
  if (!res.ok) throw new Error(`Item-Datenbank: HTTP ${res.status} für ${file}`);
  return res.json();
}

function topDrops(drops) {
  return (drops ?? [])
    .slice()
    .sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))
    .slice(0, 12)
    .map((d) => ({ location: d.location, chance: d.chance ?? null, rarity: d.rarity ?? null }));
}

// "/Lotus/Types/Items/MiscItems/OrokinCell" -> "Orokin Cell"
function nameFromPath(id) {
  return id.split('/').pop().replace(/Item$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// WFCD listet manche Bauteile doppelt (z. B. 2x "Bronco Prime" für Akbronco Prime) – zusammenfassen.
function mergeComponents(list) {
  const byId = new Map();
  for (const c of list) {
    const prev = byId.get(c.uniqueName);
    if (prev) prev.itemCount = (prev.itemCount ?? 1) + (c.itemCount ?? 1);
    else byId.set(c.uniqueName, { ...c });
  }
  return [...byId.values()];
}

// Blaupausen, Bauteile und Waffen sind "Teile"; alles andere (Orokin-Zelle, Ferrit …) Rohstoffe.
const isPart = (id) => /\/Recipes\/|\/Weapons\/|\/Powersuits\//.test(id);

async function build() {
  const [components, resources, misc, ...lists] = await Promise.all([
    getJson('Components.json'),
    getJson('Resources.json'),
    // Viele Rohstoffe (Neurode, Plastids, Nanospores …) stehen nur hier
    getJson('Misc.json').catch(() => []),
    ...CATEGORIES.map(([file]) => getJson(`${file}.json`)),
  ]);

  const compInfo = new Map();
  const img = (name) => (name ? IMG + name : null);
  for (const r of [...misc, ...resources]) compInfo.set(r.uniqueName, { name: r.name, drops: [], image: img(r.imageName) });
  for (const c of components) {
    compInfo.set(c.uniqueName, {
      name: c.name,
      drops: topDrops(c.drops),
      ducats: c.primeSellingPrice ?? null,
      image: img(c.imageName),
    });
  }

  const items = [];
  const seen = new Set();
  CATEGORIES.forEach(([, category, frameLike], i) => {
    for (const it of lists[i]) {
      if (!it.masterable || seen.has(it.uniqueName)) continue;
      seen.add(it.uniqueName);
      const cap = it.maxLevelCap ?? 30;
      items.push({
        id: it.uniqueName,
        name: it.name,
        category,
        masteryReq: it.masteryReq ?? 0,
        // XP für Max-Rang: Warframe-artig 1000·Rang², Waffen 500·Rang²
        maxXp: (frameLike ? 1000 : 500) * cap * cap,
        maxRank: cap,
        image: it.imageName ? IMG + it.imageName : null,
        isPrime: !!it.isPrime,
        vaulted: it.vaulted ?? null,
        wiki: it.wikiaUrl ?? null,
        credits: it.buildPrice ?? 0,
        components: mergeComponents(it.components ?? []).map((c) => {
          const info = compInfo.get(c.uniqueName) ?? {};
          return {
            id: c.uniqueName,
            kind: isPart(c.uniqueName) ? 'part' : 'resource',
            name: info.name ?? c.name ?? nameFromPath(c.uniqueName),
            count: c.itemCount ?? 1,
            drops: info.drops ?? topDrops(c.drops),
            ducats: info.ducats ?? c.primeSellingPrice ?? null,
            // Rohstoffe wie Neurode fehlen teils in Resources.json – das Bauteil kennt sein Bild selbst
            image: info.image ?? img(c.imageName),
          };
        }),
      });
    }
  });
  items.sort((a, b) => a.name.localeCompare(b.name));
  // Waffen als Bauteil (Bolto für Akbolto …): Bild der Waffe selbst
  const imageById = new Map(items.map((it) => [it.id, it.image]));
  for (const it of items) for (const c of it.components) c.image ??= imageById.get(c.id) ?? null;
  return { version: VERSION, builtAt: Date.now(), items };
}

async function getMasteryDb(userDataDir, force) {
  const file = path.join(userDataDir, 'mastery-db.json');
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8'));
      if (cached.version === VERSION && Date.now() - cached.builtAt < TTL) return cached;
    } catch {
      /* noch kein Cache */
    }
  }
  try {
    const db = await build();
    await fs.writeFile(file, JSON.stringify(db), 'utf8');
    return db;
  } catch (e) {
    // Offline? Dann notfalls den alten Cache nehmen.
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      throw e;
    }
  }
}

module.exports = { getMasteryDb, build };

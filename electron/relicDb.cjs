// Relikt-Datenbank aus WFCD/warframe-items: Inhalt und Drop-Chancen pro Veredelungsstufe.
// Die Rohdatei ist ~9 MB groß, daher kompakt im userData-Ordner zwischengespeichert (7 Tage).
const path = require('node:path');
const fs = require('node:fs/promises');

const URL = 'https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/Relics.json';
const IMG = 'https://cdn.warframestat.us/img/';
const TTL = 7 * 24 * 60 * 60 * 1000;
const VERSION = 1;

const NAME_REF = { Intact: 'intact', Exceptional: 'exceptional', Flawless: 'flawless', Radiant: 'radiant' };

async function build() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'CephalonMerlin/0.1' } });
  if (!res.ok) throw new Error(`Relikt-Datenbank: HTTP ${res.status}`);
  const list = await res.json();

  const relics = new Map();
  for (const r of list) {
    const m = /^(.*) (Intact|Exceptional|Flawless|Radiant)$/.exec(r.name ?? '');
    if (!m || !r.rewards?.length) continue;
    const id = r.uniqueName.replace(/(Bronze|Silver|Gold|Platinum)$/, '');
    const name = m[1];
    const relic = relics.get(id) ?? {
      id,
      name,
      tier: name.split(' ')[0],
      vaulted: !!r.vaulted,
      image: r.imageName ? IMG + r.imageName : null,
      rewards: {},
    };
    relic.rewards[NAME_REF[m[2]]] = r.rewards.map((w) => ({
      id: w.item?.uniqueName ?? null,
      name: w.item?.name ?? '?',
      slug: w.item?.warframeMarket?.urlName ?? null,
      chance: w.chance,
    }));
    relics.set(id, relic);
  }
  const items = [...relics.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { version: VERSION, builtAt: Date.now(), relics: items };
}

async function getRelicDb(userDataDir, force) {
  const file = path.join(userDataDir, 'relic-db.json');
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
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(db), 'utf8');
    return db;
  } catch (e) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      throw e;
    }
  }
}

module.exports = { getRelicDb };

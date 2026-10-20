// Erzeugt electron/recipeData.json für den Foundry-Timer:
//   node build/make-recipe-data.cjs
// Blaupause (PendingRecipes.ItemType) -> [Ergebnis-uniqueName, Name, Bild]
// Zuordnung aus warframe-public-export-plus (ExportRecipes), Namen/Bilder bevorzugt aus WFCD,
// damit sie zu den übrigen Seiten passen. Neue Inhalte fehlen hier – dafür gibt es in der App
// einen Rückfall über die Mastery-Datenbank bzw. den Pfad.
const fs = require('node:fs');
const path = require('node:path');

const PLUS = 'https://cdn.jsdelivr.net/npm/warframe-public-export-plus/';
const WFCD = 'https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/';
const PLUS_FILES = [
  'ExportResources', 'ExportWeapons', 'ExportWarframes', 'ExportSentinels', 'ExportGear',
  'ExportCustoms', 'ExportKeys', 'ExportRailjackWeapons', 'ExportDrones', 'ExportFlavour',
];
const WFCD_FILES = [
  'Resources', 'Misc', 'Gear', 'Warframes', 'Primary', 'Secondary', 'Melee', 'Archwing', 'Arch-Gun',
  'Arch-Melee', 'Sentinels', 'Pets', 'SentinelWeapons', 'Skins', 'Fish',
];

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CephalonMerlin/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res.json();
}

const fromPath = (id) =>
  id.split('/').pop().replace(/(Blueprint|Component|Item)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

(async () => {
  const [recipes, en] = await Promise.all([get(PLUS + 'ExportRecipes.json'), get(PLUS + 'dict.en.json')]);
  const plusName = new Map();
  for (const f of PLUS_FILES) {
    const data = await get(`${PLUS}${f}.json`).catch(() => ({}));
    for (const [id, v] of Object.entries(data)) if (v?.name && en[v.name]) plusName.set(id, en[v.name]);
  }

  // WFCD: Name + Bild je uniqueName, auch für Bauteile ("Odonata Prime Systems")
  const wfcd = new Map();
  const put = (id, name, image) => {
    const prev = wfcd.get(id);
    if (!prev) wfcd.set(id, [name ?? null, image ?? null]);
    else {
      prev[0] ??= name ?? null;
      prev[1] ??= image ?? null;
    }
  };
  // Components.json zuerst: kennt Bilder der Bauteile, aber nur Kurznamen ("Systems")
  const compImage = new Map();
  for (const c of await get(WFCD + 'Components.json').catch(() => [])) if (c.imageName) compImage.set(c.uniqueName, c.imageName);
  for (const f of WFCD_FILES) {
    const list = await get(`${WFCD}${f}.json`).catch(() => []);
    for (const it of list) {
      put(it.uniqueName, it.name, it.imageName);
      for (const c of it.components ?? []) {
        // Manche Dateien (Archwing) haben nur Stub-Bauteile ohne Namen
        const own = /\/(Resources|MiscItems)\//.test(c.uniqueName) || c.name === it.name;
        const name = c.name ? (own ? c.name : `${it.name} ${c.name}`) : null;
        put(c.uniqueName, name, c.imageName ?? compImage.get(c.uniqueName));
      }
    }
  }

  const out = {};
  for (const [recipe, r] of Object.entries(recipes)) {
    const res = r.resultType;
    if (!res) continue;
    const w = wfcd.get(res);
    const name = w?.[0] ?? plusName.get(res) ?? fromPath(res);
    if (/undefined/.test(name)) throw new Error(`Kaputter Name für ${recipe}`);
    out[recipe] = [res, name, w?.[1] ?? compImage.get(res) ?? null];
  }

  const file = path.join(__dirname, '..', 'electron', 'recipeData.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const noImg = Object.values(out).filter((v) => !v[2]).length;
  console.log('recipes', Object.keys(out).length, 'ohne Bild', noImg, 'bytes', fs.statSync(file).size);
})();

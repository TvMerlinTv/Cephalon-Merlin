// Erzeugt src/lib/overframeMods.json: Overframe-Mod-ID -> Mod (DE-Pfad, Name EN/DE, Max-Rang, Polarität, Bild).
//   node build/make-overframe-mods.cjs [<URL oder Datei des Overframe-Chunks db/mods.<hash>.js>]
//
// Overframe speichert in Builds nur eigene Mod-IDs (slots[].mod). Die Zuordnung steckt im Webseiten-Chunk
// https://static.overframe.gg/_next/static/chunks/db/mods.<hash>.js (Schlüssel = DE-Pfad, Feld id = Overframe-ID).
// Der Hash ändert sich bei jedem Overframe-Update. Neue URL finden: eine Build-Seite auf overframe.gg öffnen,
// in den Entwicklertools unter Netzwerk nach "db/mods." filtern.
// Bilder in der App: warframe.market-Kartenbilder (über gameRef = DE-Pfad), sonst diese WFCD-Bilder.
// Namen, Max-Rang, Polarität und Seltenheit kommen von warframe-public-export-plus (DE Public Export), Bilder von WFCD.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_CHUNK = 'https://static.overframe.gg/_next/static/chunks/db/mods.e6264c5250fc674f.js';
const PEP = 'https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai/';
const WFCD = 'https://cdn.jsdelivr.net/npm/@wfcd/items/data/json/';
const UA = { headers: { 'User-Agent': 'CephalonMerlin-build (+https://github.com/TvMerlinTv/cephalon-merlin)' } };

async function text(src) {
  if (!/^https?:/.test(src)) return fs.readFileSync(src, 'utf8');
  const res = await fetch(src, UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${src}`);
  return res.text();
}
const json = async (src) => JSON.parse(await text(src));

// Der Chunk ist ein Webpack-Modul: self.webpackChunk_N_E.push([[id], { n: function (e) { e.exports = JSON.parse('…') } }])
function readChunk(code) {
  const sandbox = { self: { webpackChunk_N_E: [] } };
  vm.runInNewContext(code, sandbox, { timeout: 20_000 });
  const modules = sandbox.self.webpackChunk_N_E[0]?.[1] ?? {};
  for (const fn of Object.values(modules)) {
    const m = { exports: null };
    fn(m);
    if (m.exports && typeof m.exports === 'object') return m.exports;
  }
  throw new Error('Kein Mod-Verzeichnis im Overframe-Chunk gefunden');
}

function kindOf(id, up) {
  if (id.includes('/CosmeticEnhancers/')) return 'arcane';
  if (up?.type === 'AURA') return 'aura';
  if (up?.type === 'STANCE') return 'stance';
  return 'mod';
}

(async () => {
  const chunk = process.argv[2] ?? DEFAULT_CHUNK;
  const [ofCode, up, arc, en, de, wfMods, wfArc] = await Promise.all([
    text(chunk),
    json(PEP + 'ExportUpgrades.json'),
    json(PEP + 'ExportArcanes.json'),
    json(PEP + 'dict.en.json'),
    json(PEP + 'dict.de.json'),
    json(WFCD + 'Mods.json'),
    json(WFCD + 'Arcanes.json'),
  ]);
  const of = readChunk(ofCode);
  const images = new Map([...wfMods, ...wfArc].filter((m) => m.imageName).map((m) => [m.uniqueName, m.imageName]));

  const mods = {};
  let missing = 0;
  for (const [id, m] of Object.entries(of)) {
    if (typeof m?.id !== 'number') continue;
    const u = up[id] ?? arc[id];
    if (!u) missing++;
    const nameEn = (u && en[u.name]) || m.name || id.split('/').pop();
    const nameDe = (u && de[u.name]) || null;
    mods[m.id] = {
      p: id,
      n: nameEn,
      ...(nameDe && nameDe !== nameEn ? { d: nameDe } : {}),
      k: kindOf(id, up[id]),
      r: u?.fusionLimit ?? (u?.levelStats ? u.levelStats.length - 1 : null),
      pol: u?.polarity ?? m.data?.ArtifactPolarity ?? null,
      ra: (u?.rarity ?? m.data?.Rarity ?? 'COMMON').toLowerCase(),
      ...(images.has(id) ? { i: images.get(id) } : {}),
    };
  }

  const out = path.join(__dirname, '..', 'src', 'lib', 'overframeMods.json');
  fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), chunk, mods }));
  console.log(`${Object.keys(mods).length} Mods geschrieben (${missing} ohne DE-Daten, Namen dann von Overframe) -> ${out}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

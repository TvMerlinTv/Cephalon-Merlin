// Erzeugt src/lib/rivenData.json aus warframe-public-export-plus:
//   node build/make-riven-data.cjs <ExportUpgrades.json> <dict.en.json>
// Basiswerte der Riven-Stats ändern sich selten – Dispositionen kommen live von warframe.market.
const fs = require('node:fs');
const path = require('node:path');

const [upFile, dictFile] = process.argv.slice(2);
const up = JSON.parse(fs.readFileSync(upFile, 'utf8'));
const en = JSON.parse(fs.readFileSync(dictFile, 'utf8'));

// Text ohne Farb-Tags: "|val|% <DT_FIRE_COLOR>Heat" -> "|val|% Heat"
const clean = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\|STAT1\|/g, '|val|').trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const stats = {};
for (const [id, mod] of Object.entries(up)) {
  if (!id.includes('/Randomized/') || !mod.upgradeEntries) continue;
  const type = id.split('/').pop().replace('RandomModRare', '');
  stats[type] = {};
  for (const e of mod.upgradeEntries) {
    stats[type][e.tag] = {
      base: e.upgradeValues[0].value,
      text: clean(en[e.upgradeValues[0].locTag]),
      prefix: cap(en[e.prefixTag]),
      suffix: en[e.suffixTag] ?? '',
      buff: e.canBeBuff !== false,
      curse: e.canBeCurse !== false,
    };
  }
}

// Herausforderungen verschleierter Rivens
const challenges = {};
for (const [k, v] of Object.entries(en)) {
  const m = k.match(/^\/Lotus\/Language\/Challenges\/Challenge_(.+)$/);
  if (m && /_(Description|ResetOnDamageTaken)$|^Complication_/.test(m[1])) challenges[m[1]] = clean(v);
}

const out = path.join(__dirname, '..', 'src', 'lib', 'rivenData.json');
fs.writeFileSync(out, JSON.stringify({ stats, challenges }));
console.log('types', Object.keys(stats).length, 'challenges', Object.keys(challenges).length, 'bytes', fs.statSync(out).size);

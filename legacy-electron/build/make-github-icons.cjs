// Symbole für die GitHub-Seite (github/assets/icons/*.svg) aus denselben lucide-Icons wie in der App:
//   node build/make-github-icons.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');
const out = path.join(root, 'github', 'assets', 'icons');
const COLOR = '#8b6dff'; // App-Akzentfarbe, gut lesbar in GitHubs hellem und dunklem Design

// Seitenleiste der App (src/components/Sidebar.jsx) + Timer-Panel (Globe) + Overlay (MonitorPlay, wie in Hilfe/Info)
const ICONS = {
  foundry: 'hammer',
  mastery: 'chevrons-up',
  inventory: 'package',
  relics: 'flame',
  builds: 'wrench',
  rivens: 'dices',
  market: 'store',
  trade: 'hand-coins',
  stats: 'chart-column', // = BarChart3 in der App
  timer: 'globe',
  overlay: 'monitor-play',
};

const attr = (o) =>
  Object.entries(o)
    .filter(([k]) => k !== 'key')
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');

fs.mkdirSync(out, { recursive: true });
for (const [name, file] of Object.entries(ICONS)) {
  const js = fs.readFileSync(path.join(src, `${file}.js`), 'utf8');
  const m = /createLucideIcon\("[^"]+",\s*(\[[\s\S]*\])\);/.exec(js);
  if (!m) throw new Error(`Icon nicht lesbar: ${file}`);
  const nodes = JSON.parse(m[1].replace(/([{,]\s*)([a-zA-Z]\w*)\s*:/g, '$1"$2":'));
  const body = nodes.map(([tag, a]) => `<${tag} ${attr(a)}/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
  console.log(`✔ ${name}.svg (${file})`);
}

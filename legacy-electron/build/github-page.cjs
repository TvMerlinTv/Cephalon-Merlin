// GitHub-Seite des Repositorys aktualisieren: github/README.md → README.md, github/assets/* → assets/*
//   node build/github-page.cjs
// Repository aus package.json ("updateRepo"), Token NUR aus GH_TOKEN (wird nie ausgegeben).
// Lädt nur Dateien hoch, die sich geändert haben (ein Commit pro Datei).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const repo = String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).updateRepo ?? '').trim();
const token = process.env.GH_TOKEN;
if (!repo || !token) {
  console.error(`\n✖ ${!repo ? 'Kein "updateRepo" in package.json.' : 'GH_TOKEN ist nicht gesetzt.'} Siehe UPDATES.md.\n`);
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'CephalonMerlin-page',
};

const src = path.join(root, 'github');
const files = [['README.md', path.join(src, 'README.md')]];
for (const f of fs.readdirSync(path.join(src, 'assets'), { recursive: true })) {
  const abs = path.join(src, 'assets', f);
  if (fs.statSync(abs).isFile()) files.push([`assets/${f.split(path.sep).join('/')}`, abs]);
}

// Git-Blob-SHA, um unveränderte Dateien zu überspringen
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

(async () => {
  for (const [target, file] of files) {
    const buf = fs.readFileSync(file);
    const url = `https://api.github.com/repos/${repo}/contents/${target.split('/').map(encodeURIComponent).join('/')}`;
    const cur = await fetch(url, { headers });
    if (cur.status === 401) throw new Error('GH_TOKEN wird von GitHub abgelehnt.');
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    if (sha === blobSha(buf)) {
      console.log(`= ${target} (unverändert)`);
      continue;
    }
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Seite: ${target} aktualisiert`, content: buf.toString('base64'), sha }),
    });
    if (!res.ok) throw new Error(`${target}: HTTP ${res.status} ${(await res.json().catch(() => ({}))).message ?? ''}`);
    console.log(`✔ ${target}`);
  }
  console.log(`\nFertig: https://github.com/${repo}\n`);
})().catch((e) => {
  console.error(`\n✖ ${e.message ?? e}\n`);
  process.exit(1);
});

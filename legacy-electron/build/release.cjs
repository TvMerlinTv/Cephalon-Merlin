// Neue Version veröffentlichen: .exe bauen und als GitHub-Release hochladen.
//   npm run release                          – baut und lädt hoch
//   npm run release -- --skip-build          – nur hochladen (release/Cephalon Merlin.exe muss existieren)
//   npm run release -- --notes "Text"        – Versionshinweise direkt angeben
// Versionshinweise sonst aus build/release-notes.md (falls vorhanden).
// Version aus package.json ("version"), Repository aus "updateRepo".
// Der Token kommt NUR aus der Umgebungsvariable GH_TOKEN und wird weder gespeichert noch ausgegeben.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const repo = String(pkg.updateRepo ?? '').trim();
const exeName = pkg.build?.portable?.artifactName ?? 'Cephalon Merlin.exe';
const exe = path.join(root, 'release', exeName);
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const notesArg = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : null;
const notesFile = path.join(__dirname, 'release-notes.md');
const notes = notesArg ?? (fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function manualGuide(reason) {
  const releasesUrl = repo ? `https://github.com/${repo}/releases/new?tag=${encodeURIComponent(tag)}` : 'https://github.com/<besitzer>/<repo>/releases/new';
  console.log(`
${reason}

So veröffentlichst du die Version von Hand im Browser:
  1. Öffne ${releasesUrl}
  2. Tag: ${tag}   (neu anlegen lassen, Ziel: main)
  3. Titel: ${tag}, darunter die Versionshinweise (was ist neu?)
  4. Ziehe diese Dateien in das Feld „Attach binaries“:
       ${exe}
       ${path.join(root, 'release', 'app-update.gz')}
       ${path.join(root, 'release', 'app-update.json')}
  5. „Set as a pre-release“ NICHT anhaken, dann „Publish release“.
Danach finden alle Cephalon-Merlin-Versionen ab dem nächsten Start das Update.
`);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Ungültige Version in package.json: ${version}`);

/**
 * electron-builder (NSIS) kann keine Pfade über 260 Zeichen. Liegt das Projekt sehr tief, wird über ein
 * vorübergehendes Laufwerk (subst) mit kurzem Pfad gebaut und das Laufwerk danach wieder entfernt.
 */
function buildExe() {
  if (process.platform !== 'win32' || root.length < 110) {
    execSync('npx electron-builder --win portable', { cwd: root, stdio: 'inherit' });
    return;
  }
  const letter = [...'RSTUVWXYQPON'].map((l) => `${l}:`).find((l) => !fs.existsSync(`${l}\\`));
  if (!letter) fail('Kein freier Laufwerksbuchstabe für den kurzen Build-Pfad gefunden.');
  execSync(`subst ${letter} "${root}"`);
  try {
    console.log(`(Projektpfad zu lang – baue über ${letter}\\)`);
    execSync('npx electron-builder --win portable', { cwd: `${letter}\\`, stdio: 'inherit' });
  } finally {
    execSync(`subst ${letter} /D`);
  }
}

if (!skipBuild) {
  console.log(`Baue Cephalon Merlin ${version} …`);
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
  buildExe();
  // Preview auf denselben Stand bringen (dist/ ist gerade frisch gebaut) – sonst hängt sie eine Version hinterher
  execSync('node build/preview.cjs', { cwd: root, stdio: 'inherit' });
}
if (!fs.existsSync(exe)) fail(`Nicht gefunden: ${exe}`);
console.log(`\n✔ Fertig gebaut: ${exe} (${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);

// Kleines Update: nur der App-Code (dist/, electron/, package.json) – siehe electron/appOverlay.cjs
const { buildPack, sha256 } = require('../electron/appOverlay.cjs');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const packFiles = { 'package.json': fs.readFileSync(path.join(root, 'package.json')) };
for (const dir of ['dist', 'electron']) {
  for (const rel of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    const abs = path.join(root, dir, rel);
    if (fs.statSync(abs).isFile()) packFiles[`${dir}/${rel.split(path.sep).join('/')}`] = fs.readFileSync(abs);
  }
}
const pack = buildPack({ version, electron: electronVersion, files: packFiles });
const packFile = path.join(root, 'release', 'app-update.gz');
const manifestFile = path.join(root, 'release', 'app-update.json');
fs.writeFileSync(packFile, pack);
fs.writeFileSync(manifestFile, JSON.stringify({ version, electron: electronVersion, size: pack.length, sha256: sha256(pack) }, null, 2));
console.log(`✔ Kleines Update: ${packFile} (${(pack.length / 1024).toFixed(0)} KB, Electron ${electronVersion})`);

const token = process.env.GH_TOKEN;
if (!repo) {
  manualGuide('In package.json ist noch kein "updateRepo" (besitzer/repo) eingetragen – es wird nichts hochgeladen.');
  process.exit(0);
}
if (!token) {
  manualGuide('GH_TOKEN ist nicht gesetzt – es wird nichts hochgeladen.');
  process.exit(0);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'CephalonMerlin-release',
};

async function gh(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keine JSON-Antwort */
  }
  return { status: res.status, ok: res.ok, data };
}

/** Netzwerkfehler (z. B. abgebrochene Verbindung) bis zu 3× wiederholen. */
async function retry(what, fn) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 3) throw new Error(`${what}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
      console.warn(`  ${what}: Verbindung abgebrochen (${e.cause?.code ?? e.message}) – neuer Versuch …`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

(async () => {
  const api = `https://api.github.com/repos/${repo}`;
  const existing = await retry('Release suchen', () => gh('GET', `${api}/releases/tags/${tag}`));
  if (existing.status === 401) fail('GH_TOKEN wird von GitHub abgelehnt (abgelaufen oder falsch).');

  // Gibt es den Release schon (z. B. weil ein Upload abgebrochen ist), werden nur fehlende Dateien nachgeladen
  let release = existing.ok ? existing.data : null;
  if (release) {
    console.log(`Release ${tag} gibt es schon – lade nur fehlende Dateien nach.`);
  } else {
    console.log(`Lege Release ${tag} in ${repo} an …`);
    const created = await retry('Release anlegen', () =>
      gh('POST', `${api}/releases`, { tag_name: tag, name: tag, body: notes, draft: false, prerelease: false }),
    );
    if (!created.ok) {
      const msg = created.data?.message ?? `HTTP ${created.status}`;
      const hint = created.status === 422 ? ' (Ist das Repository leer? Es braucht mindestens einen Commit, z. B. eine README.)' : '';
      fail(`Release konnte nicht angelegt werden: ${msg}${hint}`);
    }
    release = created.data;
  }

  // GitHub ersetzt Leerzeichen im Namen durch Punkte („Cephalon.Merlin.exe“)
  const ghName = (n) => n.replace(/ /g, '.');
  // Paket vor der Beschreibung: Ohne app-update.json versucht keine App das kleine Update
  const uploads = [
    [exeName, exe, 'application/octet-stream'],
    ['app-update.gz', packFile, 'application/gzip'],
    ['app-update.json', manifestFile, 'application/json'],
  ];
  for (const [name, f, type] of uploads) {
    const old = (release.assets ?? []).find((a) => a.name === ghName(name));
    if (old?.state === 'uploaded') {
      console.log(`= ${name} ist schon da`);
      continue;
    }
    if (old) await gh('DELETE', `${api}/releases/assets/${old.id}`); // abgebrochener Upload
    console.log(`Lade ${name} hoch …`);
    const body = fs.readFileSync(f);
    const r = await retry(name, () =>
      fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': type }, // Content-Length setzt fetch selbst
        body,
      }),
    );
    if (!r.ok) fail(`${name} konnte nicht hochgeladen werden (HTTP ${r.status}). Einfach „npm run release -- --skip-build“ erneut ausführen.`);
  }
  console.log(`\n✔ Veröffentlicht: ${release.html_url}\n`);
})().catch((e) => fail(e.message ?? String(e)));

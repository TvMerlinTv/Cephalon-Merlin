// Tests für die reinen Helfer des Selbst-Updates (electron/updater.cjs):
//   node build/test-updater.cjs            – Versionsvergleich, Asset-Auswahl, nachgebaute API-Antwort
//   node build/test-updater.cjs owner/repo – zusätzlich gegen einen echten öffentlichen Release
const assert = require('node:assert/strict');
const { compareVersions, pickAsset, evaluateRelease, buildSwapScript } = require('../electron/updater.cjs');

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`✔ ${name}`);
};

test('Versionsvergleich', () => {
  const lt = [
    ['0.1.0', '0.2.0'],
    ['0.1.9', '0.1.10'], // numerisch, nicht als Text
    ['0.9.0', '1.0.0'],
    ['1.0.0-beta', '1.0.0'],
    ['1.0.0-alpha', '1.0.0-beta'],
    ['1.0.0-beta.2', '1.0.0-beta.11'],
    ['1.0.0-1', '1.0.0-alpha'],
    ['1.0.0-beta', '1.0.0-beta.1'],
    ['unsinn', '0.0.1'],
  ];
  for (const [a, b] of lt) {
    assert.ok(compareVersions(a, b) < 0, `${a} < ${b}`);
    assert.ok(compareVersions(b, a) > 0, `${b} > ${a}`);
  }
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.2.0+build5', '0.2.0'), 0);
});

const asset = (name) => ({ name, size: 100, browser_download_url: `https://github.com/x/y/releases/download/v1/${encodeURIComponent(name)}` });

test('Asset-Auswahl', () => {
  assert.equal(pickAsset([asset('latest.yml'), asset('Cephalon Merlin.exe')]).name, 'Cephalon Merlin.exe');
  assert.equal(pickAsset([asset('Cephalon.Merlin.exe'), asset('Other.exe')]).name, 'Cephalon.Merlin.exe'); // GitHub-Umbenennung
  assert.equal(pickAsset([asset('cephalon-merlin.exe')]).name, 'cephalon-merlin.exe');
  assert.equal(pickAsset([asset('Irgendwas.exe'), asset('notes.txt')]).name, 'Irgendwas.exe'); // einzige .exe
  assert.equal(pickAsset([asset('A.exe'), asset('B.exe')]), null); // nicht eindeutig
  assert.equal(pickAsset([asset('source.zip')]), null);
  assert.equal(pickAsset(undefined), null);
});

test('Nachgebaute API-Antwort', () => {
  const release = {
    tag_name: 'v0.2.0',
    name: 'v0.2.0',
    body: '- Neu: Selbst-Update',
    html_url: 'https://github.com/x/y/releases/tag/v0.2.0',
    assets: [asset('Cephalon.Merlin.exe')],
  };
  const r = evaluateRelease(release, '0.1.0');
  assert.equal(r.version, '0.2.0');
  assert.equal(r.newer, true);
  assert.equal(r.asset.name, 'Cephalon.Merlin.exe');
  assert.equal(evaluateRelease(release, '0.2.0').newer, false);
  assert.equal(evaluateRelease(release, '0.3.0').newer, false);
  assert.equal(evaluateRelease({ ...release, assets: [] }, '0.1.0').asset, null);
  assert.throws(() => evaluateRelease({ tag_name: 'nightly' }, '0.1.0'));
});

test('Hilfsskript: Pfade mit Apostroph und Umlauten', () => {
  const s = buildSwapScript({ pid: 123, tmpFile: "C:\\Users\\O'Neil Müller\\a.tmp", exeFile: 'C:\\x\\Cephalon Merlin.exe', logFile: 'C:\\log.txt' });
  assert.ok(s.includes("$src = 'C:\\Users\\O''Neil Müller\\a.tmp'"));
  assert.ok(s.includes('$appPid = 123'));
});

(async () => {
  const repo = process.argv[2];
  if (repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'CephalonMerlin-test', Accept: 'application/vnd.github+json' } });
    assert.ok(res.ok, `HTTP ${res.status}`);
    const r = evaluateRelease(await res.json(), '0.0.1');
    console.log(`✔ Echter Release ${repo}: ${r.version}, neuer als 0.0.1: ${r.newer}, Asset: ${r.asset?.name ?? '—'}`);
    n++;
  }
  console.log(`\n${n} Tests bestanden.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

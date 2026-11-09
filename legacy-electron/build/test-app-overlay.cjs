// Tests für kleine Updates (electron/appOverlay.cjs):  node build/test-app-overlay.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const ov = require('../electron/appOverlay.cjs');

const EL = '33.4.11';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ov-'));
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`✔ ${name}`);
};
const files = (extra = {}) => ({
  'package.json': Buffer.from('{"version":"0.2.0"}'),
  'electron/main.cjs': Buffer.from('// main'),
  'electron/preload.cjs': Buffer.from('// preload'),
  'electron/gameReader.ps1': Buffer.from('Write-Host ä'),
  'dist/index.html': Buffer.from('<html>'),
  'dist/assets/app.js': Buffer.from('x'.repeat(1000)),
  ...extra,
});
const fresh = (name) => {
  const r = path.join(base, name, 'app');
  return r;
};

try {
  test('Paket bauen und einspielen', () => {
    const root = fresh('a');
    const gz = ov.buildPack({ version: '0.2.0', electron: EL, files: files() });
    const dir = ov.installPack(root, gz, { version: '0.2.0', electron: EL });
    assert.equal(fs.readFileSync(path.join(dir, 'electron', 'gameReader.ps1'), 'utf8'), 'Write-Host ä');
    assert.equal(fs.readFileSync(path.join(dir, 'dist', 'assets', 'app.js'), 'utf8').length, 1000);
    assert.ok(!fs.existsSync(path.join(root, '0.2.0.tmp')));
  });

  test('Start wählt das Paket, wenn es neuer ist als die .exe', () => {
    const root = fresh('a');
    const pick = ov.choose(root, '0.1.1', EL);
    assert.equal(pick.version, '0.2.0');
    assert.equal(pick.dir, path.join(root, '0.2.0'));
  });

  test('Rückfall auf die .exe nach zwei gescheiterten Starts', () => {
    const root = fresh('a');
    assert.ok(ov.choose(root, '0.1.1', EL)); // 2. Versuch (1. war oben)
    assert.equal(ov.choose(root, '0.1.1', EL), null); // 3. Start: Rückfall
    assert.equal(ov.failedVersion(root), '0.2.0');
  });

  test('Bestätigtes Paket bleibt dauerhaft', () => {
    const root = fresh('b');
    ov.installPack(root, ov.buildPack({ version: '0.2.0', electron: EL, files: files() }), { version: '0.2.0', electron: EL });
    ov.choose(root, '0.1.1', EL);
    ov.confirm(root, '0.2.0');
    for (let i = 0; i < 5; i++) assert.equal(ov.choose(root, '0.1.1', EL)?.version, '0.2.0');
  });

  test('Neueres Paket ersetzt älteres, alte Ordner werden beim Start aufgeräumt', () => {
    const root = fresh('b');
    ov.installPack(root, ov.buildPack({ version: '0.3.0', electron: EL, files: files() }), { version: '0.3.0', electron: EL });
    assert.equal(ov.choose(root, '0.1.1', EL).version, '0.3.0');
    assert.ok(!fs.existsSync(path.join(root, '0.2.0')));
  });

  test('Neuere .exe gewinnt und entfernt das Paket', () => {
    const root = fresh('b');
    assert.equal(ov.choose(root, '0.3.0', EL), null);
    assert.ok(!fs.existsSync(root));
  });

  test('Andere Electron-Version → Paket wird nicht geladen', () => {
    const root = fresh('c');
    ov.installPack(root, ov.buildPack({ version: '0.2.0', electron: EL, files: files() }), { version: '0.2.0', electron: EL });
    assert.equal(ov.choose(root, '0.1.1', '34.0.0'), null);
  });

  test('Falsche Version/Electron im Paket wird abgelehnt', () => {
    const gz = ov.buildPack({ version: '0.2.0', electron: EL, files: files() });
    assert.throws(() => ov.installPack(fresh('d'), gz, { version: '0.2.1', electron: EL }), /passt nicht/);
    assert.throws(() => ov.installPack(fresh('d'), gz, { version: '0.2.0', electron: '34.0.0' }), /passt nicht/);
  });

  test('Unvollständiges Paket wird abgelehnt', () => {
    const f = files();
    delete f['electron/main.cjs'];
    const gz = ov.buildPack({ version: '0.2.0', electron: EL, files: f });
    assert.throws(() => ov.installPack(fresh('e'), gz, { version: '0.2.0', electron: EL }), /unvollständig/);
  });

  test('Pfade außerhalb des Ordners werden abgelehnt', () => {
    const bad = { format: 1, version: '0.2.0', electron: EL, files: {} };
    for (const [k, v] of Object.entries(files({ '../../böse.txt': Buffer.from('x') }))) bad.files[k] = v.toString('base64');
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bad)));
    assert.throws(() => ov.installPack(fresh('f'), gz, { version: '0.2.0', electron: EL }), /ungültige Pfade/);
    assert.ok(!fs.existsSync(path.join(base, 'böse.txt')));
  });

  test('Prüfsumme', () => {
    const gz = ov.buildPack({ version: '0.2.0', electron: EL, files: files() });
    assert.match(ov.sha256(gz), /^[0-9a-f]{64}$/);
    assert.notEqual(ov.sha256(gz), ov.sha256(Buffer.concat([gz, Buffer.from([0])])));
  });

  test('Ohne installiertes Paket startet die .exe', () => {
    assert.equal(ov.choose(fresh('g'), '0.1.1', EL), null);
  });

  console.log(`\n${n} Tests bestanden.`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

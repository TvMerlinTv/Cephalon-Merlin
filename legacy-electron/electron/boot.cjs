// Startlader (Einstieg laut package.json "main").
// Liegt im Datenordner ein neuerer App-Code von einem kleinen Update (appOverlay.cjs), wird dieser
// gestartet, sonst der Code in der .exe. Nur in der echten portablen .exe – Preview/Dev starten immer
// ihren eigenen Code.
const { app } = require('electron');
const path = require('node:path');

let entry = path.join(__dirname, 'main.cjs');

if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE) {
  try {
    const { resolveDataDir } = require('./dataDir.cjs');
    const overlay = require('./appOverlay.cjs');
    const root = overlay.rootDir(resolveDataDir(app.getPath('appData')));
    const pick = overlay.choose(root, app.getVersion(), process.versions.electron);
    if (pick) {
      const bundled = app.getVersion();
      // Ab hier meldet die App die Version des geladenen Codes (Update-Prüfung, Hilfe/Info)
      app.getVersion = () => pick.version;
      process.env.CM_APP_CODE = pick.dir;
      process.env.CM_BUNDLED_VERSION = bundled;
      entry = path.join(pick.dir, 'electron', 'main.cjs');
    }
  } catch {
    /* im Zweifel den Code aus der .exe starten */
  }
}

require(entry);

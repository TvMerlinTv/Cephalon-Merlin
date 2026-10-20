// Preview-Version: Electron + aktueller App-Stand in einem kurzen Ordner (%USERPROFILE%\CephalonMerlin-Preview).
// Kein Packen einer .exe nötig – nach "vite build" nur die App-Dateien kopieren:
//   npm run preview
// Eine laufende Preview wird dabei geschlossen und danach neu geöffnet (abschalten: --no-restart).
// Kurzer Pfad, weil Electron unter dem (sehr langen) Projektpfad nicht startet.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const target = path.join(process.env.USERPROFILE, 'CephalonMerlin-Preview');
const exe = path.join(target, 'Cephalon Merlin Preview.exe');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const versionFile = path.join(target, 'electron-version.txt');
const restart = !process.argv.includes('--no-restart');
const shortcut = path.join(process.env.USERPROFILE, 'Desktop', 'Cephalon Merlin Preview.lnk');

// Laufende Preview schließen, damit keine Datei gesperrt ist und der neue Stand sicher geladen wird
function closePreview() {
  const running = () => {
    try {
      return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes(path.basename(exe));
    } catch {
      return false;
    }
  };
  if (!running()) return;
  try {
    execFileSync('taskkill', ['/IM', path.basename(exe), '/F'], { stdio: 'ignore' });
  } catch {
    /* schon beendet */
  }
  for (let i = 0; i < 40 && running(); i++) execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250']);
  console.log('Preview geschlossen.');
}

// Über den Explorer starten (wie ein Doppelklick auf die Verknüpfung) – so läuft sie wie sonst auch
function openPreview() {
  spawn('explorer.exe', [fs.existsSync(shortcut) ? shortcut : exe], { detached: true, stdio: 'ignore' }).unref();
  console.log('Preview neu geöffnet.');
}

if (restart) closePreview();

// Electron-Laufzeit nur beim ersten Mal (oder nach einem Electron-Update) kopieren
const have = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
if (have !== electronVersion || !fs.existsSync(exe)) {
  console.log(`Kopiere Electron ${electronVersion} …`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(electronDist, target, { recursive: true });
  fs.renameSync(path.join(target, 'electron.exe'), exe);
  fs.rmSync(path.join(target, 'resources', 'default_app.asar'), { force: true });
  fs.writeFileSync(versionFile, electronVersion);
}

// App-Dateien: Electron startet resources/app automatisch
const app = path.join(target, 'resources', 'app');
fs.rmSync(app, { recursive: true, force: true });
for (const dir of ['dist', 'electron']) fs.cpSync(path.join(root, dir), path.join(app, dir), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(app, 'package.json'));
console.log(`Preview aktualisiert: ${exe}`);
if (restart) openPreview();

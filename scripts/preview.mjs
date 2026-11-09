// Preview-Version der Rust-App: Release-Build in einen kurzen Ordner
// (%USERPROFILE%\CMRS-Preview) plus Desktop-Verknüpfung "Cephalon Merlin RS Preview".
//   npm run preview            baut, kopiert, schließt die laufende Preview und startet sie neu
//   npm run preview -- --no-restart
// Gestartet wird über explorer.exe + Verknüpfung, damit die App wie bei einem normalen
// Doppelklick läuft (nicht im Container des aufrufenden Programms).
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(process.env.USERPROFILE, 'CMRS-Preview');
const exeName = 'Cephalon Merlin RS Preview.exe';
const exe = path.join(target, exeName);
const shortcut = path.join(process.env.USERPROFILE, 'Desktop', 'Cephalon Merlin RS Preview.lnk');
const restart = !process.argv.includes('--no-restart');
const cargo = path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe');

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: false });

// 1) Oberfläche bauen, 2) Rust im Release-Modus (bettet dist/ ein)
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
run(cargo, ['build', '--release', '--features', 'custom-protocol'], path.join(root, 'src-tauri'));
const built = path.join(root, 'src-tauri', 'target', 'release', 'cephalon-merlin.exe');

// Laufende Preview schließen, damit die Datei nicht gesperrt ist
function closePreview() {
  try {
    const list = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    if (!list.includes(exeName)) return;
    execFileSync('taskkill', ['/IM', exeName, '/F'], { stdio: 'ignore' });
    execSync('ping -n 2 127.0.0.1 >nul'); // kurz warten, bis Windows die Datei freigibt
  } catch {
    /* lief nicht */
  }
}
closePreview();
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(built, exe);
const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`Preview: ${exe} (${mb} MB)`);

// Desktop-Verknüpfung (einmal anlegen bzw. aktualisieren)
const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut.replace(/'/g, "''")}');` +
  `$s.TargetPath='${exe.replace(/'/g, "''")}';$s.WorkingDirectory='${target.replace(/'/g, "''")}';` +
  `$s.IconLocation='${exe.replace(/'/g, "''")},0';$s.Description='Cephalon Merlin RS (Preview)';$s.Save()`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });

if (restart) {
  try {
    execFileSync('explorer.exe', [shortcut], { stdio: 'ignore' });
  } catch {
    /* explorer.exe meldet auch bei Erfolg oft Exit-Code 1 */
  }
  console.log('Preview gestartet.');
}

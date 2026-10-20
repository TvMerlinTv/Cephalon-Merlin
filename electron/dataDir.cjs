// Datenordner: %APPDATA%\Cephalon Merlin
// Früher hieß er %APPDATA%\tennodeck – beim ersten Start wird er einmalig umgezogen,
// damit Einstellungen, Inventar, To-Do-Liste, Statistiken usw. erhalten bleiben.
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'Cephalon Merlin';
const OLD_NAME = 'tennodeck';
// Daran erkennt man einen Ordner mit echten Daten (nicht nur einen leeren, den Electron angelegt hat)
const MARKERS = ['settings.json', 'inventory.json', 'todo.json', 'stats.json'];

const hasData = (dir) => MARKERS.some((f) => fs.existsSync(path.join(dir, f)));

/** Liefert den Datenordner und zieht den alten bei Bedarf um. Schlägt das fehl, bleibt es (diesmal) beim alten Ordner. */
function resolveDataDir(appData) {
  const dir = path.join(appData, NAME);
  const old = path.join(appData, OLD_NAME);
  if (!fs.existsSync(old) || hasData(dir)) return dir;
  try {
    if (!fs.existsSync(dir)) {
      fs.renameSync(old, dir); // Normalfall: einfach umbenennen
    } else {
      // Neuer Ordner existiert schon (ohne unsere Daten): Inhalt einzeln hinüberschieben
      for (const entry of fs.readdirSync(old)) {
        const to = path.join(dir, entry);
        if (!fs.existsSync(to)) fs.renameSync(path.join(old, entry), to);
      }
      if (hasData(old)) return old; // nicht alles geschafft – lieber weiter mit dem alten Ordner
      try {
        fs.rmdirSync(old); // nur wenn leer – nichts löschen, was nicht umgezogen ist
      } catch {
        /* Reste bleiben liegen */
      }
    }
    return dir;
  } catch {
    // z. B. weil eine ältere Version noch läuft und Dateien sperrt – beim nächsten Start erneut
    return hasData(dir) ? dir : old;
  }
}

module.exports = { resolveDataDir, NAME, OLD_NAME };

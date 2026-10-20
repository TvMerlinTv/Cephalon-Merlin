# Updates für Cephalon Merlin

Die portable `Cephalon Merlin.exe` sucht beim Start (und danach alle 6 Stunden) auf GitHub nach
einer neueren Version. Gibt es eine, erscheint oben in der Titelleiste **„Update x.y.z“**. Ein Klick
zeigt die Versionshinweise und **„Jetzt aktualisieren“**: Die neue .exe wird neben die alte geladen,
die App schließt sich, die .exe wird ersetzt und startet neu. Einstellungen und Daten bleiben
erhalten (Ordner `%APPDATA%\Cephalon Merlin`). Unter **Hilfe / Info → „Nach Updates suchen“** geht das
auch von Hand.

Die Preview und `npm run dev` aktualisieren sich nicht selbst.

### Kleine Updates (nur App-Code)

Zu jedem Release lädt `npm run release` neben der .exe auch `app-update.gz` (nur `dist/`, `electron/`,
`package.json`, wenige hundert KB) und `app-update.json` (Version, Electron-Version, Prüfsumme) hoch.
Passt die Electron-Version zur installierten .exe, lädt die App nur dieses Paket nach
`%APPDATA%\Cephalon Merlin\app\<version>\` und startet neu – die .exe bleibt unverändert.
`electron/boot.cjs` startet dann diesen Code statt des Codes in der .exe.

- Neue Electron-Version (oder kein Paket im Release) → automatisch die ganze .exe wie bisher.
- Startet ein neuer Code-Stand zweimal nicht bis zum geladenen Fenster, nimmt die App wieder den Code
  aus der .exe und lädt beim nächsten Update die ganze .exe.
- Kommt später eine neuere .exe, wird der Ordner `app\` automatisch entfernt.
- Tests: `node build/test-app-overlay.cjs`

## 1. Einmalig: Repository anlegen

1. Auf <https://github.com/new> (angemeldet als **TvMerlinTv**) das Repository **`cephalon-merlin`** anlegen.
   - **Public** – sonst kann die App die Releases ohne Anmeldung nicht sehen.
   - „Add a README file“ anhaken (ein leeres Repository kann keine Releases bekommen).
2. In `package.json` ist es schon eingetragen:
   ```json
   "updateRepo": "TvMerlinTv/cephalon-merlin",
   ```
   Leer (`""`) bedeutet: keine Update-Prüfung. Solange das Repository oder ein Release noch fehlt,
   bleibt die Prüfung still (GitHub antwortet dann mit 404).
3. Einmal `npm run dist` bauen und diese .exe weitergeben – erst Versionen mit eingetragenem
   `updateRepo` können sich selbst aktualisieren.

## 2. Für jede neue Version

1. `version` in `package.json` erhöhen, z. B. `0.1.0` → `0.2.0`
   (Schema `Major.Minor.Patch`; nur höhere Versionen gelten als Update).
2. Optional die Versionshinweise in `build/release-notes.md` schreiben (Markdown-Text,
   wird im Update-Fenster angezeigt).
3. Veröffentlichen – **mit Token** (automatisch) oder **ohne** (von Hand im Browser).

### Mit Token (automatisch)

Einmalig einen Token anlegen: <https://github.com/settings/personal-access-tokens/new> →
„Only select repositories“ → dein Repository → *Repository permissions* → **Contents: Read and write**.

Dann in PowerShell (der Token gilt nur für dieses Fenster und wird nirgends gespeichert):

```powershell
$env:GH_TOKEN = "github_pat_…"
npm run release
```

Das baut die .exe (`vite build` + `electron-builder --win portable`), legt den Release `v<version>`
an und lädt `Cephalon Merlin.exe` hoch. Weitere Optionen:

- `npm run release -- --skip-build` – nur hochladen, die .exe liegt schon in `release/`
- `npm run release -- --notes "Text"` – Versionshinweise direkt angeben

### Ohne Token (von Hand)

`npm run release` ohne `GH_TOKEN` baut nur die .exe und zeigt danach die Schritte:

1. <https://github.com/TvMerlinTv/cephalon-merlin/releases/new> öffnen
2. Tag `v0.2.0` eingeben („Create new tag“), Titel `v0.2.0`, Versionshinweise darunter
3. `release/Cephalon Merlin.exe` in „Attach binaries“ ziehen
   (GitHub nennt sie dann `Cephalon.Merlin.exe` – das ist in Ordnung)
4. **Kein** „pre-release“ anhaken → „Publish release“

## Gut zu wissen

- Geprüft wird immer nur der neueste veröffentlichte Release („Latest“). Entwürfe und
  Pre-Releases werden ignoriert.
- Ohne Internet oder bei GitHub-Fehlern passiert im Hintergrund nichts; „Nach Updates suchen“ zeigt
  den Fehler an.
- Klappt das Ersetzen nicht (z. B. weil die .exe in einem schreibgeschützten Ordner liegt), startet
  die alte Version wieder. Ein Protokoll steht in `%APPDATA%\Cephalon Merlin\update.log`.
- Windows SmartScreen kann bei einer neuen, unsignierten .exe wieder warnen.

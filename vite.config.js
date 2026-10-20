import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);

/** Breite/Höhe aus dem PNG-Header (reicht für die Test-Screenshots). */
async function imageSize(file) {
  const buf = await fs.readFile(file);
  if (buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return { width: 1920, height: 1080 };
}

// Browser-Modus (npm run web): Spieldaten-Endpunkte für den lokalen Dev-Server,
// damit die Oberfläche auch ohne Electron mit echten Daten getestet werden kann.
// Nutzt denselben Datenordner wie die Electron-App.
function localGameApi() {
  const dataDir = require('./electron/dataDir.cjs').resolveDataDir(process.env.APPDATA ?? path.join(os.homedir(), '.config'));
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'local-game-api',
    configureServer(server) {
      server.middlewares.use('/local', async (req, res) => {
        const { syncFromGame, loadLastInventory, statsHistory } = require('./electron/game.cjs');
        const { getMasteryDb } = require('./electron/masteryDb.cjs');
        const { getRelicDb } = require('./electron/relicDb.cjs');
        const { getWorldState } = require('./electron/world.cjs');
        const { recognize, analyze } = require('./electron/screenScan.cjs');
        const url = new URL(req.url, 'http://local');
        const imagePath = url.searchParams.get('path') ?? '';
        const isImage = /\.(png|jpe?g|bmp)$/i.test(imagePath);
        try {
          // Overlay-Test im Browser: Screenshot-Datei auswerten bzw. als Hintergrund liefern
          if (url.pathname === '/scan-file' && isImage) {
            const [words, relicDb, inv] = await Promise.all([recognize(imagePath), getRelicDb(dataDir), loadLastInventory(dataDir)]);
            const { width, height } = await imageSize(imagePath);
            const owned = inv?.relics ? new Set(Object.keys(inv.relics)) : null;
            return send(res, 200, { ...analyze(words, relicDb, owned), screen: { width, height, scale: 1 }, reason: 'file' });
          }
          if (url.pathname === '/image' && isImage) {
            res.setHeader('Content-Type', imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
            return res.end(await fs.readFile(imagePath));
          }
          if (req.url.startsWith('/relics')) return send(res, 200, await getRelicDb(dataDir, req.url.includes('force')));
          if (req.url.startsWith('/world')) return send(res, 200, await getWorldState(dataDir));
          if (req.url.startsWith('/stats')) return send(res, 200, await statsHistory(dataDir));
          // Belohnungs-Log: GET = Liste, POST ?id=&chosen= = Wahl setzen, POST ?id=&remove = löschen
          if (url.pathname === '/reward-log') {
            const rl = require('./electron/rewardLog.cjs');
            const id = url.searchParams.get('id') ?? '';
            if (req.method === 'POST' && url.searchParams.has('remove')) return send(res, 200, await rl.removeRun(dataDir, id));
            if (req.method === 'POST') return send(res, 200, await rl.setChoice(dataDir, id, url.searchParams.get('chosen')));
            return send(res, 200, await rl.loadRuns(dataDir));
          }
          if (req.url.startsWith('/last')) return send(res, 200, await loadLastInventory(dataDir));
          if (req.url.startsWith('/sync') && req.method === 'POST') return send(res, 200, await syncFromGame(dataDir));
          if (req.url.startsWith('/mastery')) return send(res, 200, await getMasteryDb(dataDir, req.url.includes('force')));
          send(res, 404, { error: 'unbekannt' });
        } catch (e) {
          send(res, 500, { error: e.message });
        }
      });
    },
  };
}

// API-Aufrufe laufen im Browser über diesen Proxy, weil warframe.market keine
// CORS-Header sendet. In Electron übernimmt das der Main-Prozess.
export default defineConfig({
  plugins: [react(), localGameApi()],
  base: './',
  // Pfade nicht auflösen: unter AppData\Roaming leitet Windows sonst auf einen virtuellen Ordner um.
  resolve: { preserveSymlinks: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/proxy/market': {
        target: 'https://api.warframe.market',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/market/, ''),
      },
      '/proxy/stat': {
        target: 'https://api.warframestat.us',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/stat/, ''),
      },
      '/proxy/overframe/api/v1/': {
        target: 'https://overframe.gg',
        changeOrigin: true,
        headers: { 'User-Agent': 'CephalonMerlin/dev' },
        rewrite: (p) => p.replace(/^\/proxy\/overframe/, ''),
      },
    },
  },
});

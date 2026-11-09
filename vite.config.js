import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Tauri lädt im Dev-Modus http://localhost:1420, im Build den Ordner dist/.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});

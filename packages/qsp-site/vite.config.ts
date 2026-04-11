import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Proxy is no longer needed — all games are in public/
// const PROD = 'https://if-quests.ru';
const gameRoutes: string[] = [];

export default defineConfig({
  resolve: {
    alias: {
      'qsp-core': resolve(__dirname, '../qsp-core/src'),
      'qsp-player': resolve(__dirname, '../qsp-player/src'),
    },
  },
  build: {
    outDir: '../../dist/site',
    emptyOutDir: true,
  },
  server: {
    proxy: Object.fromEntries(
      gameRoutes.map(r => [r, { target: PROD, changeOrigin: true }])
    ),
  },
});

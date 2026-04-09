import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PROD = 'https://if-quests.ru';
const gameRoutes = ['/games.json', '/pirates', '/steelrat', '/jupiter2'];

export default defineConfig({
  resolve: {
    alias: {
      'qsp-core': resolve(__dirname, '../qsp-core/src'),
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

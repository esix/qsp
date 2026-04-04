import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
});

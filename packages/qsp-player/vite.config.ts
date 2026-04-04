import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'qsp-core': resolve(__dirname, '../qsp-core/src'),
    },
  },
});

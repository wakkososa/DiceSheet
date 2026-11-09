import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [vue()],
  build: { outDir: path.resolve(import.meta.dirname, '../dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: { proxy: { '/api': 'http://localhost:3311' } },
});

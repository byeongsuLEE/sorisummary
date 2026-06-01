import { defineConfig } from 'vite';

export default defineConfig({
  base: '/sorisummary/',
  server: {
    port: 3000,
    open: true,
    host: true
  },
  build: {
    outDir: 'dist'
  }
});

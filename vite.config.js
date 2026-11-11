import { defineConfig } from 'vite';
export default defineConfig({
  // ARGUS_BASE is set by the GitHub Pages build, where the site lives under /argus/.
  base: process.env.ARGUS_BASE || '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { include: ['satellite.js', 'h3-js', 'mgrs', 'pbf', '@mapbox/vector-tile'] },
});

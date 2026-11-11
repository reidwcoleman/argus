import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { include: ['satellite.js', 'h3-js', 'mgrs', 'pbf', '@mapbox/vector-tile'] },
});

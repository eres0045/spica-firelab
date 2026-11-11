import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served from a sub-path on GitHub Pages (eres0045.github.io/spica-firelab/),
  // so every emitted asset URL is relative. Local preview still works at root.
  base: './',
  plugins: [react(), tailwindcss()],
  // Dev only: the Vite server proxies /api to the local Flask verdict
  // engine (backend/app.py on :5000), so the app can be tested against
  // the live API without a build. Production deploys use same-origin
  // (Netlify rewrite) or the Netlify URL (GitHub Pages).
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
  build: {
    // cleaned.json (1.65 MB) is bundled so the app works offline.
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'jsdom',
    globals: true, // lets @testing-library/react auto-cleanup between tests
    include: ['src/**/*.test.{js,jsx}'],
  },
});

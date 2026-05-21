import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Enables Vite's React fast refresh and JSX handling.
  plugins: [react()],
  server: {
    // The frontend dev server runs on http://localhost:5173.
    port: 5173,
    proxy: {
      // During local development, browser calls to /api are forwarded to
      // the Express API server instead of being handled by Vite.
      '/api': 'http://127.0.0.1:5000'
    }
  },
  build: {
    // Vercel serves this folder after `npm run build`.
    outDir: 'dist'
  }
});

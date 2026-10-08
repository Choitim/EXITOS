import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dashboard is served by `exitos ui` under a strict Content-Security-Policy
 * (`script-src 'self'; style-src 'self'`), so the build must emit only external, hashed files:
 * no inline scripts, no inline styles and no remote assets.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Never inline assets as data: URIs; every file is served from this origin.
    assetsInlineLimit: 0,
    // The polyfill would be one more piece of injected code; every supported browser has modulepreload.
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // During development `exitos ui` (default port 4173) provides the state document. That server
    // accepts only its own Host header (DNS-rebinding defence), hence changeOrigin.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4173', changeOrigin: true },
    },
  },
});

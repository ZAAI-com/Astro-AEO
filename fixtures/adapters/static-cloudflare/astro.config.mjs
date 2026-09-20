import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import aeo from '../../../src/index.js';

// Issue #8 was reported on this adapter. Static output plus an adapter, every page
// route prerendered, one on-demand endpoint. Astro-AEO's injected fallback routes
// promote the build to server output, so a worker and a wrangler config are still
// emitted, but the corpus belongs to the build. No `base`, so the corpus lands at the
// root of the assets directory the worker serves from.
export default defineConfig({
  site: 'https://static-adapter.example.com',
  output: 'static',
  adapter: cloudflare(),
  server: {
    // The runtime test sends Host: static-adapter.example.com so origin-scoped
    // artifacts resolve the same way they would in production.
    allowedHosts: ['static-adapter.example.com'],
  },
  integrations: [
    aeo({
      corpus: { index: { enabled: true }, full: { enabled: true } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

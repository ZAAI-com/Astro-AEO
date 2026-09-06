import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../src/index.js';

// The shape from issue #8: static output with an adapter installed, every page
// route prerendered, and a single on-demand endpoint. Astro-AEO's own injected
// fallback routes promote this build to server output, so the corpus must be
// decided by the project's pages rather than by that promotion.
export default defineConfig({
  site: 'https://static-adapter.example.com',
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    aeo({
      corpus: { index: { enabled: true }, full: { enabled: true } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

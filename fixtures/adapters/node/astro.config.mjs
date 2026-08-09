import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../../src/index.js';

export default defineConfig({
  site: 'https://adapter.example.com',
  base: '/docs',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      pages: { catalogs: [{ module: '../shared/catalog.js' }] },
      corpus: { index: { enabled: true }, full: { enabled: true } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

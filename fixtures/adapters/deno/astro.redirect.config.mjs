import { defineConfig } from 'astro/config';
import deno from '@deno/astro-adapter';
import aeo from '../../../src/index.js';

export default defineConfig({
  site: 'https://adapter.example.com',
  base: '/docs',
  output: 'server',
  adapter: deno({ hostname: '127.0.0.1', port: 4513, start: true }),
  integrations: [
    aeo({
      markdown: { negotiation: 'redirect' },
      pages: { catalogs: [{ module: '../shared/catalog.js' }] },
      corpus: { index: { enabled: true }, full: { enabled: true } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../../src/index.js';

const trailingSlash = process.env.ASTRO_AEO_TRAILING_SLASH ?? 'ignore';
if (!['always', 'never', 'ignore'].includes(trailingSlash)) {
  throw new TypeError(`Unsupported ASTRO_AEO_TRAILING_SLASH value: ${trailingSlash}`);
}

export default defineConfig({
  site: 'https://adapter.example.com',
  base: '/docs',
  trailingSlash,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      pages: { catalogs: [{ module: '../shared/catalog.js' }] },
      corpus: { index: { enabled: true }, full: { enabled: true } },
      schema: {
        corpus: { enabled: process.env.ASTRO_AEO_SCHEMA_CORPUS === '1' },
      },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

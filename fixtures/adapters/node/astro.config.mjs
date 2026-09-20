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
  // Astro 5 and 6 run the Node adapter request through `validateHost`, which
  // rewrites the request host to `localhost` unless the domain is allowed. The
  // compatibility gate sends `Host: adapter.example.com` to a loopback listener
  // so production host scoping is exercised on every pinned Astro version.
  security: { allowedDomains: [{ hostname: 'adapter.example.com' }] },
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

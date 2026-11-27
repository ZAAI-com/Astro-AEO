import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://mixed.example.com',
  // Astro 6 and 7.4+ rebuild the Node adapter's request URL from `Host` only when
  // it matches allowedDomains; otherwise the origin is localhost and origin-scoped
  // artifacts such as llms.txt correctly decline it.
  security: { allowedDomains: [{ hostname: 'mixed.example.com' }] },
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [aeo({ discovery: { sitemap: { mode: 'disabled' } } })],
});

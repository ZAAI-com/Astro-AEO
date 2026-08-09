import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import aeo from '../../../src/index.js';

export default defineConfig({
  site: 'https://adapter.example.com',
  output: 'server',
  adapter: netlify(),
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      corpus: { index: { enabled: false }, full: { enabled: false } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

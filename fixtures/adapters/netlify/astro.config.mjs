import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import aeo from '../../../src/index.js';
import providerPlugin from '../shared/provider-plugin.mjs';

export default defineConfig({
  site: 'https://adapter.example.com',
  output: 'server',
  adapter: netlify(),
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      corpus: { index: { enabled: true }, full: { enabled: true } },
      schema: { corpus: { enabled: true } },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } },
      plugins: [providerPlugin],
    }),
  ],
});

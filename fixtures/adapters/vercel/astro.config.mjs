import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import aeo from '../../../src/index.js';
import providerPlugin from '../shared/provider-plugin.mjs';

export default defineConfig({
  site: 'https://adapter.example.com',
  output: 'server',
  adapter: vercel(),
  // Rolldown must bundle the adapter entrypoint. Leaving it external makes a
  // provider entry module invalid before Vercel can shape the function output.
  vite: { ssr: { noExternal: ['@astrojs/vercel'] } },
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      corpus: { index: { enabled: true }, full: { enabled: true } },
      schema: {
        corpus: {
          enabled: true,
          graphPath: '/schema/graph%20data.jsonld',
          mapPath: '/schema/caf%C3%A9-map.xml',
        },
      },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } },
      plugins: [providerPlugin],
    }),
  ],
});

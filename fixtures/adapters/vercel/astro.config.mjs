import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import aeo from '../../../src/index.js';

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
      corpus: { index: { enabled: false }, full: { enabled: false } },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } },
    }),
  ],
});

import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      pages: { catalogs: [{ module: './src/aeo-catalog.js' }] },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

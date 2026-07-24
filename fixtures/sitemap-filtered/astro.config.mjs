import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://filtered.example.com',
  integrations: [
    aeo({
      sitemap: { options: { filter: () => false } },
      robotsTxt: { enabled: true },
    }),
  ],
});

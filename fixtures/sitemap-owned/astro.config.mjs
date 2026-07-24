import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://owned.example.com',
  integrations: [
    sitemap({ filenameBase: 'custom' }),
    aeo({
      sitemap: {
        enabled: false,
        // With a user-registered integration, filenameBase is the shared output
        // hint that keeps the alias source and robots path aligned.
        options: { filenameBase: 'custom' },
      },
      robotsTxt: { enabled: true },
    }),
  ],
});

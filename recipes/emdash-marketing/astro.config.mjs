import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import emdashAeo from 'astro-aeo/emdash';

export default defineConfig({
  site: 'https://recipe.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: 'file:./data.db' }),
      storage: local({ directory: './uploads', baseUrl: '/_emdash/api/media/file' }),
    }),
    // Fixed routes serve the `pages` collection, which has no URL pattern, so the
    // defaults are all this template needs.
    emdashAeo(),
  ],
});

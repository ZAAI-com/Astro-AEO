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
    emdashAeo({
      collections: {
        // Section URLs come from each collection's seed urlPattern:
        // /blog/{year}/{month}/{slug} matches /blog/**.
        posts: { section: 'Blog' },
        customers: { section: 'Customers' },
        // Legal pages stay on the site but out of llms.txt and llms-full.txt.
        legal: false,
      },
    }),
  ],
});

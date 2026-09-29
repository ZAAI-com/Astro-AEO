import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: 'file:./data.db' }),
      storage: local({
        directory: './uploads',
        baseUrl: '/_emdash/api/media/file',
      }),
    }),
    aeo({
      markdown: { negotiation: 'response' },
      pages: {
        // EmDash's admin and API live under /_emdash and must stay out of
        // corpora, companions, and negotiation.
        exclude: ['/_emdash/**'],
        catalogs: [{ module: './src/aeo-emdash-catalog.js' }],
      },
      corpus: {
        index: {
          sections: [
            { title: 'Posts', match: '/posts/**' },
            { title: 'Work', match: '/work/**' },
          ],
        },
      },
      // EmDash injects its own /robots.txt and /sitemap.xml routes, so this
      // integration leaves robots policy and the sitemap to the CMS.
      discovery: { robots: { enabled: false }, sitemap: { mode: 'disabled' } },
    }),
  ],
});

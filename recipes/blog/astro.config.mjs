import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [
    aeo({
      corpus: { index: { sections: [{ title: 'Posts', match: '/blog/**' }] } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

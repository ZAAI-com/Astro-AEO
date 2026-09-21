import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [aeo({ pages: { exclude: ['/app/**'] }, discovery: { sitemap: { mode: 'disabled' } } })],
});

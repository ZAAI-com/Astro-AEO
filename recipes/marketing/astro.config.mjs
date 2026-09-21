import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [aeo({ discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } } })],
});

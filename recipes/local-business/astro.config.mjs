import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [
    aeo({
      site: {
        profile: { enabled: true, name: 'Harbor Street Bakery', description: 'A neighborhood bakery.', email: 'hello@recipe.example.com' },
      },
      discovery: {
        sitemap: { mode: 'disabled' },
      },
    }),
  ],
});

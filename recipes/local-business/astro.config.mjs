import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [
    aeo({
      discovery: {
        domainProfile: { enabled: true, name: 'Harbor Street Bakery', description: 'A neighborhood bakery.', contactEmail: 'hello@recipe.example.com' },
        sitemap: { mode: 'disabled' },
      },
    }),
  ],
});

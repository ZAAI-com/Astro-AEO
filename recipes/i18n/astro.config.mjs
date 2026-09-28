import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';

export default defineConfig({
  site: 'https://recipe.example.com',
  i18n: { locales: ['en', 'de'], defaultLocale: 'en' },
  integrations: [aeo({ i18n: { indexes: 'auto' }, discovery: { sitemap: { mode: 'disabled' } } })],
});

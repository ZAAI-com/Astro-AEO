import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import emdash from 'emdash/astro';
import { d1, r2 } from '@emdash-cms/cloudflare';
import emdashAeo from 'astro-aeo/emdash';

export default defineConfig({
  site: 'https://recipe.example.com',
  output: 'server',
  adapter: cloudflare(),
  // `astro preview` runs the Worker in workerd locally. llms.txt answers only for the
  // configured site origin, so the preview server must accept that Host header.
  server: { allowedHosts: ['recipe.example.com'] },
  integrations: [
    react(),
    emdash({
      database: d1({ binding: 'DB', session: 'auto' }),
      storage: r2({ binding: 'MEDIA' }),
    }),
    // The same options as the Node recipe: the catalog reads D1 through EmDash's
    // per-request database, so nothing here is Cloudflare-specific.
    emdashAeo({
      collections: {
        posts: { section: 'Blog' },
        customers: { section: 'Customers' },
        legal: false,
      },
    }),
  ],
});

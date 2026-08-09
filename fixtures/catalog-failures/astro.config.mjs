import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://catalog-failures.example',
  integrations: [
    aeo({
      pages: {
        catalogs: [
          { module: './src/healthy-catalog.js' },
          { module: './src/missing-catalog.js' },
          { module: './src/syntax-catalog.js' },
          { module: './src/throwing-catalog.js' },
        ],
      },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

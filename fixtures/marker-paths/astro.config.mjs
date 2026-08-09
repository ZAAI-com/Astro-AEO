import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://marker-paths.example.com',
  trailingSlash: 'always',
  build: { format: 'file' },
  integrations: [
    aeo({
      corpus: { index: { enabled: false }, full: { enabled: false } },
      discovery: { sitemap: { mode: 'disabled' } },
    }),
  ],
});

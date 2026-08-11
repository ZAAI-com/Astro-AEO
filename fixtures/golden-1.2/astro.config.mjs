import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://semantic.example.com',
  trailingSlash: 'never',
  outDir: './dist',
  integrations: [
    aeo({
      site: { name: 'Semantic Fixture' },
      markdown: { enabled: false },
      corpus: {
        index: { enabled: false },
        full: { enabled: false },
      },
      discovery: {
        sitemap: { mode: 'disabled', alias: { enabled: false } },
      },
    }),
  ],
});

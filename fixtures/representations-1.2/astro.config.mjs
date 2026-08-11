import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://representations.example.com',
  trailingSlash: 'never',
  outDir: './dist',
  integrations: [
    aeo({
      pages: {
        catalogs: [{ module: './catalog.mjs' }],
      },
      markdown: {
        includeLastModified: false,
        renderers: [
          {
            module: 'astro-aeo/mdx',
            options: {
              components: {
                Callout: { action: 'element', name: 'aside' },
              },
            },
          },
          { module: './custom-renderer.mjs' },
        ],
        extraction: {
          selectors: ['article', 'main'],
          removeSelectors: ['nav', 'footer'],
          keepSelectors: ['.callout'],
        },
      },
      corpus: {
        index: { enabled: false },
        full: { enabled: false },
      },
      discovery: {
        sitemap: { mode: 'disabled', alias: { enabled: false } },
      },
      schema: { autoInject: false },
    }),
  ],
});

import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../src/index.js';
const mode = process.env.AEO_ANALYTICS_MODE;
export default defineConfig({
  site: 'https://analytics.example.test', base: '/docs', output: 'server', adapter: node({ mode: 'standalone' }),
  integrations: [aeo({
    analytics: mode === 'absent' ? undefined : { enabled: mode !== 'disabled', scope: 'all',
      adapter: mode === 'jsonl' ? { type: 'jsonl', path: '.astro/events-v1.jsonl' } : mode === 'module' ? { type: 'module', module: './sink.mjs', options: { expected: true } } : { type: 'console' } },
    pages: { catalogs: [{ module: './catalog.mjs' }], exclude: ['/static'] },
    markdown: { negotiation: 'response', includeLastModified: false },
    corpus: { full: { enabled: true } }, discovery: { sitemap: { mode: 'disabled' } },
  })],
});

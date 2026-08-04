import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../src/index.js';

// On-demand rendering, which is the only place content negotiation can apply:
// Astro does not expose request headers to a prerendered route.
export default defineConfig({
  site: 'https://ssr.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    aeo({
      // stripTitleSuffix is here to guard it at request time: the runtime once
      // built no stripper of its own, so it silently stopped applying.
      pages: { exclude: ['/private/**'], stripTitleSuffix: 'SSR Site' },
      markdown: { frontmatter: true, negotiation: 'response' },
      discovery: { robots: { enabled: true, allow: ['Googlebot'] }, sitemap: { mode: 'disabled' } },
    }),
  ],
});

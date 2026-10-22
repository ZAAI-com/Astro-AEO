import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// Demo site: exercises every astro-aeo feature. Doubles as the e2e fixture.
export default defineConfig({
  site: 'https://demo.example.com',
  trailingSlash: 'always',
  integrations: [
    aeo({
      pages: {
        stripTitleSuffix: 'Demo Site',
        exclude: ['/private/**'],
      },
      markdown: { frontmatter: true },
      corpus: {
        index: {
          showLastModified: true,
          sections: [
            { title: 'Home', match: '/' },
            { title: 'Blog', match: '/blog/**' },
          ],
          defaultSection: 'Pages',
        },
        urlMap: {
          enabled: true,
          outputFilepath: '.astro/test-url-map.md',
        },
      },
      discovery: {
        robots: {
          enabled: true,
          allow: ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot'],
          disallow: ['GPTBot', 'ClaudeBot'],
        },
      },
      site: {
        profile: {
          enabled: true,
          name: 'Astro-AEO Demo',
          description: 'A tiny site that exercises astro-aeo.',
          email: 'hello@example.com',
          entityType: 'Organization',
        },
      },
    }),
  ],
});

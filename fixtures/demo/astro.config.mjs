import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// Demo site: exercises every astro-aeo feature. Doubles as the e2e fixture.
export default defineConfig({
  site: 'https://demo.example.com',
  trailingSlash: 'always',
  integrations: [
    aeo({
      stripTitleSuffix: 'Demo Site',
      exclude: ['/private/**'],
      llmsTxt: {
        showLastmod: true,
        sections: [
          { title: 'Home', match: '/' },
          { title: 'Blog', match: '/blog/**' },
        ],
        defaultSection: 'Pages',
      },
      dotmd: { frontmatter: true },
      robotsTxt: {
        enabled: true,
        allow: ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot'],
        disallow: ['GPTBot', 'ClaudeBot'],
      },
      domainProfile: {
        enabled: true,
        name: 'Astro-AEO Demo',
        description: 'A tiny site that exercises astro-aeo.',
        email: 'hello@example.com',
        entityType: 'Organization',
      },
    }),
  ],
});

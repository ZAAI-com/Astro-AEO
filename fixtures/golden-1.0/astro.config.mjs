import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://golden.example.com',
  trailingSlash: 'always',
  outDir: './dist',
  integrations: [
    aeo({
      stripTitleSuffix: 'Golden Site',
      exclude: ['/private/**'],
      respectNoindex: true,
      dotmd: {
        frontmatter: true,
        includeLastModified: false,
      },
      llmsTxt: {
        showLastmod: false,
        includeNoDotmd: true,
        sections: [
          { title: 'Home', match: '/' },
          { title: 'Blog', match: '/blog/**' },
        ],
        defaultSection: 'Pages',
      },
      llmsFullTxt: { mode: 'all' },
      sitemap: { enabled: true, options: { filenameBase: 'golden' } },
      sitemapAlias: { enabled: true },
      robotsTxt: {
        enabled: true,
        allow: ['OAI-SearchBot'],
        disallow: ['GPTBot'],
        extraLines: ['# frozen 1.0 fixture'],
      },
      domainProfile: {
        enabled: true,
        name: 'Golden Site',
        description: 'Frozen Astro-AEO 1.0 output.',
        contact: 'hello@golden.example.com',
        entityType: 'Organization',
      },
    }),
  ],
});

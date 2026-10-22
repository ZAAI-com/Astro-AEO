import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// The same site as astro.canonical.config.mjs, spelled with every 1.0 key. 2.0
// removed those keys, so this build must fail and name each one. Keep the two in
// lockstep so the printed replacement is the canonical config.
export default defineConfig({
  site: 'https://compat.example.com',
  trailingSlash: 'always',
  outDir: './dist-legacy',
  integrations: [
    aeo({
      stripTitleSuffix: 'Compat Site',
      exclude: ['/private/**'],
      respectNoindex: true,
      llmsTxt: {
        showLastmod: true,
        includeNoDotmd: true,
        sections: [
          { title: 'Home', match: '/' },
          { title: 'Blog', match: '/blog/**' },
        ],
        defaultSection: 'Pages',
      },
      llmsFullTxt: { mode: 'all' },
      dotmd: { frontmatter: true, linkTag: 'auto' },
      urlMap: { enabled: false },
      sitemap: { enabled: true, options: { filenameBase: 'compat' } },
      sitemapAlias: { enabled: true },
      robotsTxt: {
        enabled: true,
        allow: ['Googlebot', 'OAI-SearchBot'],
        disallow: ['GPTBot'],
        extraLines: ['# compat fixture'],
      },
      domainProfile: {
        enabled: true,
        name: 'Compat Site',
        description: 'Proves 2.0 builds what 1.6 built.',
        contact: 'hello@compat.example.com',
        sameAs: ['https://github.com/example'],
        entityType: 'Organization',
      },
    }),
  ],
});

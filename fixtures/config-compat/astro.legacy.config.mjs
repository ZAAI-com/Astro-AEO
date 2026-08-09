import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// Half of the 1.0 -> 1.1 compatibility proof: every option spelled the 1.0 way.
// Its twin, astro.canonical.config.mjs, spells the same site the 1.1 way, and the
// e2e diffs the two builds file by file. Keep the two in lockstep.
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
        description: 'Proves the 1.0 keys still work.',
        contact: 'hello@compat.example.com',
        sameAs: ['https://github.com/example'],
        entityType: 'Organization',
      },
    }),
  ],
});

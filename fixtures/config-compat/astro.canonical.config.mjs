import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// The 1.1 spelling of astro.legacy.config.mjs. Both builds must emit byte-identical
// output; that equivalence is the compatibility guarantee for the config rename.
export default defineConfig({
  site: 'https://compat.example.com',
  trailingSlash: 'always',
  outDir: './dist-canonical',
  integrations: [
    aeo({
      pages: {
        stripTitleSuffix: 'Compat Site',
        exclude: ['/private/**'],
        respectNoindex: true,
      },
      corpus: {
        index: {
          showLastModified: true,
          includeHtmlOnly: true,
          sections: [
            { title: 'Home', match: '/' },
            { title: 'Blog', match: '/blog/**' },
          ],
          defaultSection: 'Pages',
        },
        full: { mode: 'all' },
        urlMap: { enabled: false },
      },
      markdown: { frontmatter: true, alternateLink: 'auto' },
      discovery: {
        sitemap: {
          mode: 'auto',
          options: { filenameBase: 'compat' },
          alias: { enabled: true },
        },
        robots: {
          enabled: true,
          allow: ['Googlebot', 'OAI-SearchBot'],
          disallow: ['GPTBot'],
          extraLines: ['# compat fixture'],
        },
      },
      site: {
        profile: {
          enabled: true,
          name: 'Compat Site',
          description: 'Proves the 1.0 keys still work.',
          email: 'hello@compat.example.com',
          sameAs: ['https://github.com/example'],
          entityType: 'Organization',
        },
      },
    }),
  ],
});

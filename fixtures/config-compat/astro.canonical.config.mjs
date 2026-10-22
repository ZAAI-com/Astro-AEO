import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// The canonical spelling of astro.legacy.config.mjs. Its build must stay
// byte-identical to the one the published 1.6.1 release produced (expected-1.6.json).
// Every page carries an explicit modified time, so no output depends on git history.
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
          description: 'Proves 2.0 builds what 1.6 built.',
          email: 'hello@compat.example.com',
          sameAs: ['https://github.com/example'],
          entityType: 'Organization',
        },
      },
    }),
  ],
});

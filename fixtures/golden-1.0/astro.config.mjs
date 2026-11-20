import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';

// The 1.0 configuration of this fixture, translated key for key into the
// canonical spelling (2.0 removed the 1.0 aliases). expected.json is unchanged:
// the bytes must still match the 1.0 release.
export default defineConfig({
  site: 'https://golden.example.com',
  trailingSlash: 'always',
  outDir: './dist',
  integrations: [
    aeo({
      // 1.2 enables managed JSON-LD by default. Keep this frozen fixture on 1.0 HTML behavior.
      schema: { autoInject: false },
      pages: {
        stripTitleSuffix: 'Golden Site',
        exclude: ['/private/**'],
        respectNoindex: true,
      },
      markdown: {
        frontmatter: true,
        includeLastModified: false,
      },
      corpus: {
        index: {
          showLastModified: false,
          includeHtmlOnly: true,
          sections: [
            { title: 'Home', match: '/' },
            { title: 'Blog', match: '/blog/**' },
          ],
          defaultSection: 'Pages',
        },
        full: { mode: 'all' },
      },
      discovery: {
        sitemap: {
          mode: 'auto',
          options: { filenameBase: 'golden' },
          alias: { enabled: true },
        },
        robots: {
          enabled: true,
          allow: ['OAI-SearchBot'],
          disallow: ['GPTBot'],
          extraLines: ['# frozen 1.0 fixture'],
        },
      },
      site: {
        profile: {
          enabled: true,
          name: 'Golden Site',
          description: 'Frozen Astro-AEO 1.0 output.',
          email: 'hello@golden.example.com',
          entityType: 'Organization',
        },
      },
    }),
  ],
});

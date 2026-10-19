import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightAeo from '../../src/starlight.js';

export default defineConfig({
  site: 'https://starlight-versions.example.test', base: '/docs',
  integrations: [starlight({
    title: 'Versioned Docs', pagefind: false,
    defaultLocale: 'en', locales: { en: { label: 'English' }, fr: { label: 'Français', lang: 'fr' } },
    editLink: { baseUrl: 'https://example.test/edit/' },
    plugins: [starlightAeo({
      versions: { current: 'v2', archived: [{ version: 'v1', prefix: 'release-1' }] },
      links: { pagination: false, source: { baseUrl: 'https://example.test/blob/main/' }, versions: true },
      aeo: { markdown: { includeLastModified: false, negotiation: 'response' }, i18n: { indexes: 'both' },
        corpus: { manifest: { enabled: true }, chunks: { enabled: true } } },
    })],
  })],
});

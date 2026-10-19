// @ts-check
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../core/html-document.js';
import { readMarker } from '../core/extract/marker.js';
import { starlightMarker } from './marker.js';

const options = { links: { pagination: true, edit: false }, techArticle: true };
const route = (/** @type {Record<string, unknown>} */ overrides = {}) => ({
  id: 'guides/install',
  lang: 'en',
  lastUpdated: new Date('2026-03-04T00:00:00Z'),
  editUrl: new URL('https://example.com/edit/install.md'),
  pagination: { prev: { href: '/intro/', label: 'Intro [v2]' }, next: { href: '/guides/next page/', label: 'Next' } },
  entry: { id: 'guides/install', filePath: 'src/content/docs/guides/install.md', body: 'Run it.\n', data: { title: 'Install', description: 'How to install' } },
  ...overrides,
});

describe('Starlight marker', () => {
  it('uses requested/source language facts and marks untranslated pages independently of Markdown fallback', () => {
    const marker = starlightMarker(route({ id: 'fr/guides/install', locale: 'fr', lang: 'fr', isFallback: true, entryMeta: { lang: 'en' } }), options);
    expect(marker).toMatchObject({ language: 'en', localeFallback: { requested: 'fr', source: 'en' } });
    expect(marker.entities[0].inLanguage).toBe('en');
  });

  it('keeps source-view links separate from edit URLs and refuses local absolute paths', () => {
    const enabled = { ...options, links: { pagination: false, edit: false, source: { baseUrl: 'https://example.test/blob/main/' } } };
    expect(starlightMarker(route(), enabled).markdown).toContain('- Source: <https://example.test/blob/main/src/content/docs/guides/install.md>');
    expect(starlightMarker(route(), enabled).markdown).not.toContain('edit/install');
    for (const filePath of ['/private/docs.md', '../private.md', 'C:\\private.md']) {
      expect(starlightMarker(route({ entry: { ...route().entry, filePath } }), enabled).markdown).not.toContain('- Source:');
    }
  });

  it('carries configured versions and opt-in known-peer links without guessing arbitrary prefixes', () => {
    const configured = { ...options, links: { ...options.links, versions: true },
      versions: { current: 'v2', archived: [{ version: 'v1', prefix: '1.0' }] } };
    expect(starlightMarker(route({ id: 'fr/1.0/guides/install', locale: 'fr' }), configured)).toMatchObject({ version: 'v1', versionGroup: '/guides/install', versionLinks: true });
    expect(starlightMarker(route({ id: '1.0/fr/guides/install', locale: 'fr' }), configured)).toMatchObject({ version: 'v1', versionGroup: '/guides/install' });
    expect(starlightMarker(route({ id: 'v1/guides/install' }), configured)).toMatchObject({ version: 'v2', versionGroup: '/v1/guides/install' });
  });
  it('uses only what Starlight resolved', () => {
    expect(starlightMarker(route(), options)).toEqual({
      title: 'Install',
      description: 'How to install',
      language: 'en',
      lastModified: '2026-03-04T00:00:00.000Z',
      sourcePath: 'src/content/docs/guides/install.md',
      sourceKind: 'markdown',
      sourceBody: 'Run it.\n',
      markdown: '# Install\n\nRun it.\n\n---\n\n- Previous: [Intro \\[v2\\]](/intro/)\n- Next: [Next](/guides/next%20page/)\n',
      entities: [{ '@type': 'TechArticle', headline: 'Install', description: 'How to install', inLanguage: 'en', dateModified: '2026-03-04T00:00:00.000Z' }],
    });
  });

  it('honors the link and TechArticle options', () => {
    const marker = starlightMarker(route(), { links: { pagination: false, edit: true }, techArticle: false });
    expect(marker?.markdown).toBe('# Install\n\nRun it.\n\n---\n\n- Edit this page: <https://example.com/edit/install.md>\n');
    expect(marker).not.toHaveProperty('entities');
    expect(starlightMarker(route(), { links: { pagination: false, edit: false }, techArticle: false })?.markdown).toBe('# Install\n\nRun it.\n');
  });

  it('records a fallback instead of partial Markdown', () => {
    const entry = { ...route().entry, filePath: 'src/content/docs/x.mdx', body: 'Value: {value}' };
    const marker = starlightMarker(route({ entry }), options);
    expect(marker).toMatchObject({ sourceFallback: 'dynamic-mdx', sourceKind: 'mdx', title: 'Install' });
    expect(marker).not.toHaveProperty('markdown');
    expect(starlightMarker(route({ entry: { ...entry, body: undefined } }), options)).toMatchObject({ sourceFallback: 'no-source' });
  });

  it('skips the 404 page and routes without an entry title', () => {
    expect(starlightMarker(route({ id: '404' }), options)).toBeNull();
    expect(starlightMarker(route({ entry: { data: {} } }), options)).toBeNull();
    expect(starlightMarker(undefined, options)).toBeNull();
  });
});

describe('marker precedence', () => {
  it('preserves authored content while retaining inferred route version and fallback facts', () => {
    const inferred = { markdown: 'Inferred', version: 'v1', versionGroup: '/guide', versionLinks: true,
      localeFallback: { requested: 'fr', source: 'en' } };
    const html = `<html><head><script type="application/vnd.astro-aeo+json" data-astro-aeo-marker="inferred">${JSON.stringify(inferred)}</script></head><body><script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>${JSON.stringify({ markdown: 'Authored', version: 'custom' })}</script></body></html>`;
    expect(readMarker(parseDocument(html))).toEqual({ ...inferred, markdown: 'Authored', version: 'custom' });
  });

  const script = (/** @type {string} */ kind, /** @type {string} */ title) =>
    `<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker${kind}>${JSON.stringify({ title })}</script>`;

  it('prefers an authored marker over an inferred one wherever each appears', () => {
    const html = `<!doctype html><html><head>${script('="inferred"', 'Inferred')}</head><body>${script('', 'Authored')}</body></html>`;
    expect(readMarker(parseDocument(html))).toEqual({ title: 'Authored' });
  });

  it('uses the inferred marker when it is the only one', () => {
    const html = `<!doctype html><html><head>${script('="inferred"', 'Inferred')}</head><body></body></html>`;
    expect(readMarker(parseDocument(html))).toEqual({ title: 'Inferred' });
  });
});

// @ts-check
import { describe, expect, it } from 'vitest';
import { loadCatalogPages } from './build/catalogs.js';
import { contentDescriptor, contentPage, defineCmsAdapter, defineContentCatalog } from './content.js';
import { defineAeoPage } from './page.js';

const context = /** @type {const} */ ({ command: 'build', siteUrl: 'https://example.com', base: '', trailingSlash: 'ignore' });
const entry = {
  id: 'guide/install',
  filePath: 'src/content/docs/guide/install.md',
  body: '# Install\n\nRun the installer.\n',
  data: { title: 'Install', description: 'How to install', lang: 'en', version: 'v2', pubDate: '2026-01-02', updatedDate: new Date('2026-02-03T00:00:00Z') },
};
const logger = { warn() {} };

describe('content helpers', () => {
  it('contentPage reads an entry and lets overrides win', () => {
    expect(contentPage(entry, { title: 'Custom' })).toEqual({
      ...defineAeoPage({ source: entry }),
      title: 'Custom',
    });
    expect(contentPage(entry)).toMatchObject({ markdown: entry.body, version: 'v2', sourceKind: 'markdown' });
  });

  it('drops a version label that could not be one path segment', () => {
    for (const version of ['../v2', 'v 2', '', '..', 'a/b', 'x'.repeat(65), 2]) {
      expect(defineAeoPage({ version: /** @type {any} */ (version) })).not.toHaveProperty('version');
    }
    expect(defineAeoPage({ version: '2.1-rc_1' })).toEqual({ version: '2.1-rc_1' });
  });

  it('contentDescriptor builds a serializable descriptor', () => {
    const descriptor = contentDescriptor(entry, { pathname: '/guide/install', locale: 'en' });
    expect(descriptor).toEqual({
      pathname: '/guide/install',
      title: 'Install',
      description: 'How to install',
      language: 'en',
      version: 'v2',
      markdown: entry.body,
      lastModified: '2026-02-03T00:00:00.000Z',
      locale: 'en',
      dates: { published: '2026-01-02T00:00:00.000Z', modified: '2026-02-03T00:00:00.000Z' },
      sourcePath: 'src/content/docs/guide/install.md',
      source: { kind: 'markdown', path: 'src/content/docs/guide/install.md' },
    });
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(() => contentDescriptor(entry, /** @type {any} */ ({ pathname: 'relative' }))).toThrow(/root-relative/);
  });

  it('defineContentCatalog maps entries, skips nulls, and flows through the catalog loader', async () => {
    const catalog = defineContentCatalog({
      name: 'docs',
      entries: async () => [entry, { ...entry, id: 'draft', data: { ...entry.data, draft: true } }],
      toPage: (item) => (item.data.draft ? null : { pathname: `/${item.id}` }),
    });
    expect(catalog.name).toBe('docs');
    const loaded = await loadCatalogPages([{ module: './docs.js' }], async () => ({ default: catalog }), logger, context, []);
    expect(loaded.inventoryComplete).toBe(true);
    expect(loaded.pages).toEqual([expect.objectContaining({ pathname: '/guide/install', version: 'v2', markdown: entry.body })]);
  });

  it('a failing entries() is isolated by the loader like any catalog failure', async () => {
    const catalog = defineContentCatalog({ entries: () => { throw new Error('offline'); }, toPage: () => null });
    /** @type {import('./index.js').Diagnostic[]} */
    const diagnostics = [];
    const loaded = await loadCatalogPages([{ module: './docs.js' }], async () => catalog, logger, context, diagnostics);
    expect(loaded).toMatchObject({ pages: [], inventoryComplete: false });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['catalog-load-failed']);
  });

  it('defineCmsAdapter stamps every page as a CMS record, whatever the adapter claimed', async () => {
    const catalog = defineCmsAdapter({
      name: 'sanity',
      listPages: async () => [
        { id: 'post-1', pathname: '/blog/one', title: 'One', markdown: '# One', source: { kind: 'markdown', path: '/etc/passwd', hash: 'h' } },
        { pathname: '/blog/two', version: '../bad' },
      ],
    });
    /** @type {import('./index.js').Diagnostic[]} */
    const diagnostics = [];
    const loaded = await loadCatalogPages([{ module: './cms.js' }], async () => catalog, logger, context, diagnostics);
    expect(loaded.pages).toEqual([
      { pathname: '/blog/one', title: 'One', markdown: '# One', sourcePath: 'cms:sanity:post-1', source: { kind: 'cms', path: 'cms:sanity:post-1', hash: 'h' } },
      { pathname: '/blog/two', sourcePath: 'cms:sanity:/blog/two', source: { kind: 'cms', path: 'cms:sanity:/blog/two' } },
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['catalog-invalid-version']);
  });

  it('rejects an adapter without a usable name or listPages', () => {
    expect(() => defineCmsAdapter(/** @type {any} */ ({ name: 'bad name', listPages() { return []; } }))).toThrow(/name/);
    expect(() => defineCmsAdapter(/** @type {any} */ ({ name: 'ok' }))).toThrow(/listPages/);
    expect(() => defineContentCatalog(/** @type {any} */ ({}))).toThrow(/entries/);
  });
});

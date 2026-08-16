import { test, expect, describe } from 'vitest';
import { parseDocument } from '../html-document.js';
import { readMarker, removeMarkers, stripMarkersFromHtml, COLLECT_FLAG } from './marker.js';
import { defineAeoPage } from '../../page.js';
import { loadCatalogPages } from '../../build/catalogs.js';

const withMarker = (json) =>
  `<!doctype html><html><head><title>T</title></head><body><main>` +
  `<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>${json}</script>` +
  `<h1>Rendered</h1></main></body></html>`;

describe('readMarker', () => {
  test('reads the payload a page emitted', () => {
    const marker = readMarker(parseDocument(withMarker('{"markdown":"# Source","title":"S"}')));
    expect(marker).toEqual({ markdown: '# Source', title: 'S' });
  });

  test('a page without one reads as null', () => {
    expect(readMarker(parseDocument('<html><body><p>x</p></body></html>'))).toBeNull();
  });

  test('malformed JSON is ignored rather than thrown on', () => {
    // A broken marker must never fail a build: extraction is always available.
    expect(readMarker(parseDocument(withMarker('{not json')))).toBeNull();
    expect(readMarker(parseDocument(withMarker('"a string"')))).toBeNull();
  });
});

describe('removal', () => {
  test('removeMarkers strips every marker from a document', () => {
    const doc = parseDocument(withMarker('{"title":"S"}'));
    expect(removeMarkers(doc)).toBe(1);
    expect(doc.querySelector('script[data-astro-aeo-marker]')).toBeNull();
  });

  test('stripMarkersFromHtml removes it from source text, leaving the rest alone', () => {
    const html = withMarker('{"title":"S"}');
    const cleaned = stripMarkersFromHtml(html);
    expect(cleaned).not.toContain('astro-aeo-marker');
    expect(cleaned).toContain('<h1>Rendered</h1>');
    expect(cleaned).toContain('<title>T</title>');
  });

  test('an unrelated script is untouched', () => {
    const html = '<html><body><script>console.log(1)</script></body></html>';
    expect(stripMarkersFromHtml(html)).toBe(html);
  });

  test('tag-like marker text inside a script is untouched', () => {
    const html = '<html><body><script>const example = "<script data-astro-aeo-marker>";</script><p>Safe</p></body></html>';
    expect(stripMarkersFromHtml(html)).toBe(html);
  });

  test('a marker name inside another attribute value is untouched', () => {
    const html = '<script data-example=" data-astro-aeo-marker ">console.log(1)</script>';
    expect(stripMarkersFromHtml(html)).toBe(html);
  });

  test('a payload containing a closing tag cannot break out of the element', () => {
    // The component serializes through the same escaper as the JSON-LD blocks,
    // which escapes "<", so this shape cannot occur; assert the reader survives it.
    const doc = parseDocument(withMarker('{"markdown":"a \\u003c/script\\u003e b"}'));
    expect(readMarker(doc)?.markdown).toContain('</script>');
  });
});

describe('defineAeoPage', () => {
  test('passes through what it is given', () => {
    expect(defineAeoPage({ markdown: '# X', title: 'X', description: 'd' })).toEqual({
      markdown: '# X',
      title: 'X',
      description: 'd',
    });
  });

  test('reads a content-collection entry', () => {
    const marker = defineAeoPage({
      source: {
        body: '# From the entry',
        data: { title: 'Entry', description: 'Desc', updatedDate: new Date('2026-02-15T00:00:00Z') },
        filePath: 'src/content/blog/a.md',
      },
    });
    expect(marker.markdown).toBe('# From the entry');
    expect(marker.title).toBe('Entry');
    expect(marker.lastModified).toBe('2026-02-15T00:00:00.000Z');
    expect(marker.sourcePath).toBe('src/content/blog/a.md');
  });

  test('preserves an explicit source kind without requiring a source path', () => {
    expect(defineAeoPage({ markdown: '# MDX source', sourceKind: 'mdx' })).toEqual({
      markdown: '# MDX source',
      sourceKind: 'mdx',
    });
    expect(defineAeoPage({ sourceKind: 'cms' })).toEqual({ sourceKind: 'cms' });
  });

  test('validates source kinds while retaining path-based inference', () => {
    expect(defineAeoPage({ sourceKind: /** @type {any} */ ('invalid') })).toEqual({});
    expect(defineAeoPage({
      sourcePath: 'src/content/entry.mdx',
      sourceKind: /** @type {any} */ ('invalid'),
    })).toEqual({
      sourcePath: 'src/content/entry.mdx',
      sourceKind: 'mdx',
    });
    expect(defineAeoPage({ sourcePath: 'src/pages/about.astro' })).toMatchObject({
      sourceKind: 'astro',
    });
    expect(defineAeoPage({ sourcePath: 'cms:article-42' })).toMatchObject({
      sourceKind: 'cms',
    });
    expect(defineAeoPage({ sourcePath: 'generated:article-42' })).toMatchObject({
      sourceKind: 'custom',
    });
  });

  test('explicit values win over the entry', () => {
    const marker = defineAeoPage({ source: { data: { title: 'From entry' } }, title: 'Explicit' });
    expect(marker.title).toBe('Explicit');
  });

  test('supplying nothing produces nothing, so the component emits nothing', () => {
    expect(defineAeoPage()).toEqual({});
    expect(defineAeoPage({ source: {} })).toEqual({});
  });

  test('preserves explicitly empty authored Markdown as a source decision', () => {
    expect(defineAeoPage({ markdown: '' })).toEqual({ markdown: '' });
    expect(defineAeoPage({ markdown: '', sourceKind: 'custom' })).toEqual({
      markdown: '',
      sourceKind: 'custom',
    });
  });

  test('an unparseable date is dropped rather than emitted as Invalid Date', () => {
    expect(defineAeoPage({ lastModified: 'soon' }).lastModified).toBeUndefined();
  });
});

describe('loadCatalogPages', () => {
  const logger = () => {
    const warnings = [];
    return { warnings, warn: (m) => warnings.push(m) };
  };

  test('collects pages from every catalog', async () => {
    const log = logger();
    const pages = await loadCatalogPages(
      [{ module: 'a' }, { module: 'b' }],
      async (spec) => ({ default: { listPages: () => [{ pathname: `/${spec}` }] } }),
      log,
    );
    expect(pages).toEqual([{ pathname: '/a' }, { pathname: '/b' }]);
    expect(log.warnings).toEqual([]);
  });

  test('a catalog that throws warns and contributes nothing, rather than failing the build', async () => {
    const log = logger();
    const pages = await loadCatalogPages(
      [{ module: 'broken' }],
      async () => {
        throw new Error('boom');
      },
      log,
    );
    expect(pages).toEqual([]);
    expect(log.warnings[0]).toContain('failed to load');
    expect(log.warnings[0]).toContain('boom');
  });

  test('a module with no listPages warns by name', async () => {
    const log = logger();
    await loadCatalogPages([{ module: 'empty' }], async () => ({ default: {} }), log);
    expect(log.warnings[0]).toContain('no listPages()');
  });

  test('entries that are not root-relative paths are dropped', async () => {
    const log = logger();
    const pages = await loadCatalogPages(
      [{ module: 'a' }],
      async () => ({ listPages: () => [{ pathname: 'relative' }, { pathname: '/ok' }, {}] }),
      log,
    );
    expect(pages.map((p) => p.pathname)).toEqual(['/ok']);
  });

  test('passes catalog context and preserves serializable descriptor fields', async () => {
    const log = logger();
    const context = {
      command: 'build',
      siteUrl: 'https://x.com',
      base: '/docs',
      trailingSlash: 'always',
    };
    const pages = await loadCatalogPages(
      [{ module: 'a' }],
      async () => ({
        listPages(received) {
          expect(received).toEqual(context);
          return [{ pathname: '/post/', title: 'Post', markdown: '# Exact', sourcePath: 'cms:1' }];
        },
      }),
      log,
      context,
    );
    expect(pages).toEqual([
      { pathname: '/post', title: 'Post', markdown: '# Exact', sourcePath: 'cms:1' },
    ]);
  });

  test('the first catalog wins duplicate descriptors', async () => {
    const log = logger();
    const diagnostics = [];
    const pages = await loadCatalogPages(
      [{ module: 'a' }, { module: 'b' }],
      async (module) => ({ listPages: () => [{ pathname: '/same', title: module }] }),
      log,
      { command: 'build', siteUrl: '', base: '', trailingSlash: 'ignore' },
      diagnostics,
    );
    expect(pages).toEqual([{ pathname: '/same', title: 'a' }]);
    expect(log.warnings[0]).toContain('first descriptor wins');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        version: 1,
        code: 'catalog-path-conflict',
        severity: 'warning',
        pathname: '/same',
        sourcePath: 'b',
      }),
    ]);
  });
});

test('the collect flag is the documented locals key', () => {
  expect(COLLECT_FLAG).toBe('astroAeoCollect');
});

import { describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { listEmDashPages } from './inventory.js';
import { listEmDashCatalogPages } from './catalog.js';

/** @param {Partial<import('./inventory.js').EmDashEntry>} entry */
const entry = (entry) => ({ id: entry.slug ?? 'id', slug: 'slug', data: {}, ...entry });

/**
 * @param {{ collections: any[]; entries?: Record<string, any[]>; terms?: Record<string, any[]>; pageSize?: number; i18n?: any }} fixture
 */
function reader({ collections, entries = {}, terms = {}, pageSize = 100, i18n = null }) {
  const warn = vi.fn();
  return {
    warn,
    i18n,
    listCollections: vi.fn(async () => collections),
    listEntries: vi.fn(async (collection, { cursor, limit }) => {
      const all = entries[collection] ?? [];
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize);
      const next = start + size < all.length ? String(start + size) : null;
      return { items: all.slice(start, start + size), cursor: next };
    }),
    getTerms: vi.fn(async (taxonomy) => terms[taxonomy] ?? []),
  };
}

const posts = { slug: 'posts', urlPattern: '/posts/{slug}', routable: true, titleField: 'title' };

describe('listEmDashPages', () => {
  test('lists published entries of every collection with a URL pattern', async () => {
    const pages = await listEmDashPages(reader({
      collections: [
        posts,
        { slug: 'projects', urlPattern: '/work/{slug}', routable: true },
        // The Marketing template: fixed routes serve these, so nothing is guessed.
        { slug: 'pages', urlPattern: null, routable: true },
        { slug: 'sections', urlPattern: '/sections/{slug}', routable: false },
      ],
      entries: {
        posts: [entry({ id: 'p1', slug: 'hello', data: { title: 'Hello', excerpt: 'Short' }, publishedAt: '2026-01-02 03:04:05', updatedAt: '2026-02-01T00:00:00Z' })],
        projects: [entry({ id: 'w1', slug: 'acme', data: { title: 'Acme', summary: 'Rebrand' } })],
        pages: [entry({ slug: 'home' })],
        sections: [entry({ slug: 'hero' })],
      },
    }));

    expect(pages).toEqual([
      {
        id: 'posts/p1',
        pathname: '/posts/hello',
        rendering: 'on-demand',
        title: 'Hello',
        description: 'Short',
        dates: { published: '2026-01-02 03:04:05', modified: '2026-02-01T00:00:00Z' },
      },
      { id: 'projects/w1', pathname: '/work/acme', rendering: 'on-demand', title: 'Acme', description: 'Rebrand' },
    ]);
  });

  test('applies EmDash sitemap rules: slug required, noindex excluded, SEO text first', async () => {
    const pages = await listEmDashPages(reader({
      collections: [posts],
      entries: {
        posts: [
          entry({ id: 'a', slug: '  ', data: { title: 'Blank slug' } }),
          entry({ id: 'b', slug: null, data: { title: 'No slug' } }),
          entry({ id: 'c', slug: 'hidden', seo: { noIndex: true }, data: { title: 'Hidden' } }),
          entry({ id: 'd', slug: 'seo', seo: { title: 'SEO title', description: 'SEO description' }, data: { title: 'Body title', excerpt: 'Excerpt' } }),
        ],
      },
    }));
    expect(pages).toEqual([
      { id: 'posts/d', pathname: '/posts/seo', rendering: 'on-demand', title: 'SEO title', description: 'SEO description' },
    ]);
  });

  test('uses the collection title field and drops entries whose date tokens cannot resolve', async () => {
    const pages = await listEmDashPages(reader({
      collections: [{ slug: 'news', urlPattern: '/news/{year}/{slug}', routable: true, titleField: 'headline' }],
      entries: {
        news: [
          entry({ id: 'n1', slug: 'dated', data: { headline: 'Headline', title: 'Ignored' }, publishedAt: '2025-07-04T12:00:00Z' }),
          entry({ id: 'n2', slug: 'undated', data: { headline: 'Undated' }, publishedAt: null }),
        ],
      },
    }));
    expect(pages.map((page) => [page.pathname, page.title])).toEqual([['/news/2025/dated', 'Headline']]);
  });

  test('skips collections turned off and pages through every cursor', async () => {
    const many = Array.from({ length: 5 }, (_, index) => entry({ id: `p${index}`, slug: `p${index}` }));
    const source = reader({
      collections: [posts, { slug: 'legal', urlPattern: '/legal/{slug}', routable: true }],
      entries: { posts: many, legal: [entry({ slug: 'terms' })] },
      pageSize: 2,
    });
    const pages = await listEmDashPages(source, { collections: { legal: false, posts: {} } });
    expect(pages.map((page) => page.pathname)).toEqual(['/posts/p0', '/posts/p1', '/posts/p2', '/posts/p3', '/posts/p4']);
    expect(source.listEntries).toHaveBeenCalledTimes(3);
    expect(source.listEntries).not.toHaveBeenCalledWith('legal', expect.anything());
  });

  test('stops at maxEntries and warns', async () => {
    const source = reader({
      collections: [posts],
      entries: { posts: Array.from({ length: 5 }, (_, index) => entry({ id: `p${index}`, slug: `p${index}` })) },
    });
    const pages = await listEmDashPages(source, { maxEntries: 3, taxonomies: { tag: '/tag/{slug}' } });
    expect(pages).toHaveLength(3);
    expect(source.warn).toHaveBeenCalledWith(expect.stringContaining('maxEntries (3)'));
    expect(source.getTerms).not.toHaveBeenCalled();
  });

  test('lists taxonomy archives for terms in use, including nested terms', async () => {
    const pages = await listEmDashPages(
      reader({
        collections: [],
        terms: {
          category: [
            { slug: 'news', label: 'News', count: 2, children: [{ slug: 'local', label: 'Local', count: 1, children: [] }] },
            { slug: 'empty', label: 'Empty', count: 0, children: [] },
          ],
        },
      }),
      { taxonomies: { category: '/category/{slug}' } },
    );
    expect(pages).toEqual([
      { id: 'taxonomy/category/news', pathname: '/category/news', rendering: 'on-demand', title: 'News' },
      { id: 'taxonomy/category/local', pathname: '/category/local', rendering: 'on-demand', title: 'Local' },
    ]);
  });

  test('lists the default locale, prefixed only when Astro prefixes it', async () => {
    const collections = [posts];
    const entries = { posts: [entry({ id: 'p', slug: 'hola' })] };
    const unprefixed = reader({ collections, entries, i18n: { defaultLocale: 'es' } });
    expect((await listEmDashPages(unprefixed)).map((page) => page.pathname)).toEqual(['/posts/hola']);
    expect(unprefixed.listEntries).toHaveBeenCalledWith('posts', expect.objectContaining({ locale: 'es' }));
    const prefixed = reader({ collections, entries, i18n: { defaultLocale: 'es', prefixDefaultLocale: true } });
    expect((await listEmDashPages(prefixed)).map((page) => page.pathname)).toEqual(['/es/posts/hola']);
  });
});

describe('the EmDash catalog module', () => {
  test('lists nothing in the native build pass, where Node cannot load the Vite bridge', () => {
    const script = `import catalog from ${JSON.stringify(new URL('./catalog.js', import.meta.url).href)};\n` +
      "console.log(catalog.name, JSON.stringify(await catalog.listPages({ command: 'build', siteUrl: 'https://example.com', base: '/', trailingSlash: 'ignore' })));";
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('emdash []');
  });

  test('throws any other bridge failure so the runtime warns and retries', async () => {
    const failure = Object.assign(new Error('does not provide an export named getDb'), { code: 'ERR_SYNTAX' });
    await expect(listEmDashCatalogPages(async () => { throw failure; })).rejects.toBe(failure);
  });

  test('lists published entries through the bridge', async () => {
    const list = vi.fn(async () => ({ items: [entry({ slug: 'hello', data: { title: 'Hello' } })], cursor: null }));
    const bridge = {
      options: {},
      getDb: async () => ({}),
      createSchemaAccess: () => ({ listCollections: async () => [posts] }),
      createContentAccess: () => ({ list }),
      isI18nEnabled: () => false,
      getTaxonomyTerms: async () => [],
    };
    const pages = await listEmDashCatalogPages(async () => bridge);
    expect(pages.map((page) => page.pathname)).toEqual(['/posts/hello']);
    expect(list).toHaveBeenCalledWith('posts', expect.objectContaining({ where: { status: 'published' } }));
  });
});

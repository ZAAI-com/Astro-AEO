import { describe, expect, test } from 'vitest';
import {
  discoverRuntimeDynamicPaths,
  RuntimeDynamicRouteDiscoveryError,
} from './dynamic-routes.js';

const staticPart = (content) => ({ content, dynamic: false, spread: false });
const paramPart = (content, spread = false) => ({
  content: spread ? `...${content}` : content,
  dynamic: true,
  spread,
});

function runtime(command = 'dev', site = {}) {
  return {
    command,
    site: { base: '', trailingSlash: 'ignore', ...site },
  };
}

function loader({
  pattern = '/products/[slug]',
  params = ['slug'],
  segments = [[staticPart('products')], [paramPart('slug')]],
  getStaticPaths = () => [{ params: { slug: 'one' } }],
  load,
} = {}) {
  return {
    entrypoint: `src/pages${pattern}.astro`,
    pattern,
    params,
    segments,
    load: load ?? (async () => ({ getStaticPaths })),
  };
}

function source(loaders, mode = 'startup') {
  return {
    mode,
    load: async () => ({ list: () => loaders }),
  };
}

describe('discoverRuntimeDynamicPaths', () => {
  test('enumerates top-level and multi-parameter routes in deterministic order', async () => {
    const paths = await discoverRuntimeDynamicPaths(runtime(), source([
      loader({
        getStaticPaths: () => [
          { params: { slug: 'first' } },
          { params: { slug: 'second' } },
        ],
      }),
      loader({
        pattern: '/archive/[year]/[slug]',
        params: ['year', 'slug'],
        segments: [
          [staticPart('archive')],
          [paramPart('year')],
          [paramPart('slug')],
        ],
        getStaticPaths: () => [{ params: { year: '2026', slug: 'launch' } }],
      }),
    ]));
    expect(paths).toEqual(['/products/first', '/products/second', '/archive/2026/launch']);
  });

  test('supports optional spread params and deduplicates exact generated paths', async () => {
    const optional = loader({
      pattern: '/docs/[...path]',
      params: ['...path'],
      segments: [[staticPart('docs')], [paramPart('path', true)]],
      getStaticPaths: () => [
        { params: { path: undefined } },
        { params: { path: 'guide/start' } },
        { params: { path: 'guide/start' } },
      ],
    });
    expect(await discoverRuntimeDynamicPaths(runtime(), source([optional]))).toEqual([
      '/docs',
      '/docs/guide/start',
    ]);
  });

  test('normalizes Unicode, trims surrounding slashes, and escapes reserved characters', async () => {
    const decomposed = 'cafe\u0301';
    const paths = await discoverRuntimeDynamicPaths(runtime(), source([
      loader({
        getStaticPaths: () => [
          { params: { slug: decomposed } },
          { params: { slug: 'launch🚀' } },
          { params: { slug: '/trimmed/' } },
          { params: { slug: 'why?now#yes' } },
        ],
      }),
    ]));
    expect(paths).toEqual([
      '/products/café',
      '/products/launch🚀',
      '/products/trimmed',
      '/products/why%3Fnow%23yes',
    ]);
  });

  test('accepts an empty getStaticPaths result', async () => {
    expect(await discoverRuntimeDynamicPaths(runtime(), source([
      loader({ getStaticPaths: () => [] }),
    ]))).toEqual([]);
  });

  test('implements numbered pagination with the Astro page shape', async () => {
    let pages;
    const paged = loader({
      pattern: '/paged/[page]',
      params: ['page'],
      segments: [[staticPart('paged')], [paramPart('page')]],
      getStaticPaths({ paginate }) {
        pages = paginate(Array.from({ length: 11 }, (_, index) => index + 1));
        return pages;
      },
    });
    expect(await discoverRuntimeDynamicPaths(runtime(), source([paged]))).toEqual([
      '/paged/1',
      '/paged/2',
    ]);
    expect(pages[0].props.page).toMatchObject({
      data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      start: 0,
      end: 9,
      size: 10,
      total: 11,
      currentPage: 1,
      lastPage: 2,
      url: { current: '/paged/1', next: '/paged/2', prev: undefined },
    });
  });

  test('omits page one for spread pagination and carries base, props, params, slashes, and format', async () => {
    let pages;
    const paged = loader({
      pattern: '/archive/[year]/[...page]',
      params: ['year', '...page'],
      segments: [
        [staticPart('archive')],
        [paramPart('year')],
        [paramPart('page', true)],
      ],
      getStaticPaths({ paginate }) {
        pages = paginate(['a', 'b', 'c'], {
          pageSize: 2,
          params: { year: '2026' },
          props: { section: 'archive' },
          format: (url) => `formatted:${url}`,
        });
        return pages;
      },
    });
    expect(await discoverRuntimeDynamicPaths(
      runtime('dev', { base: '/docs', trailingSlash: 'always' }),
      source([paged]),
    )).toEqual(['/archive/2026/', '/archive/2026/2/']);
    expect(pages[0]).toMatchObject({
      params: { year: '2026', page: undefined },
      props: {
        section: 'archive',
        page: {
          data: ['a', 'b'],
          url: {
            current: 'formatted:/docs/archive/2026/',
            next: 'formatted:/docs/archive/2026/2/',
            prev: undefined,
            first: undefined,
            last: 'formatted:/docs/archive/2026/2/',
          },
        },
      },
    });
    expect(pages[1].props.page.url).toMatchObject({
      current: 'formatted:/docs/archive/2026/2/',
      prev: 'formatted:/docs/archive/2026/',
      first: 'formatted:/docs/archive/2026/',
      next: undefined,
      last: undefined,
    });
  });

  test('does not touch the source outside development', async () => {
    let loads = 0;
    const dynamicSource = {
      mode: 'startup',
      load: async () => {
        loads++;
        return { list: () => [loader()] };
      },
    };
    expect(await discoverRuntimeDynamicPaths(runtime('build'), dynamicSource)).toEqual([]);
    expect(await discoverRuntimeDynamicPaths(runtime('preview'), dynamicSource)).toEqual([]);
    expect(await discoverRuntimeDynamicPaths(runtime(), null)).toEqual([]);
    expect(loads).toBe(0);
  });

  test('reloads route inventory and page modules for every development request', async () => {
    let request = 0;
    const dynamicSource = {
      mode: 'startup',
      load: async () => {
        request++;
        return {
          list: () => [loader({
            getStaticPaths: () => [{ params: { slug: `request-${request}` } }],
          })],
        };
      },
    };
    expect(await discoverRuntimeDynamicPaths(runtime(), dynamicSource)).toEqual(['/products/request-1']);
    expect(await discoverRuntimeDynamicPaths(runtime(), dynamicSource)).toEqual(['/products/request-2']);
  });

  test.each([
    ['raw traversal', '../secret'],
    ['encoded traversal', '%2e%2e/secret'],
    ['double-encoded traversal', '%252e%252e/secret'],
    ['encoded slash', 'a%2Fb'],
    ['double-encoded slash', 'a%252Fb'],
    ['encoded backslash', 'a%5Cb'],
    ['malformed escape', 'a%2'],
    ['triple encoding', 'a%252520b'],
    ['unpaired high surrogate', '\uD800'],
    ['unpaired low surrogate', '\uDC00'],
  ])('rejects unsafe path input: %s', async (_name, slug) => {
    await expect(discoverRuntimeDynamicPaths(runtime(), source([
      loader({ getStaticPaths: () => [{ params: { slug } }] }),
    ]))).rejects.toMatchObject({
      name: 'RuntimeDynamicRouteDiscoveryError',
    });
  });

  test.each([
    ['non-array result', () => ({ params: { slug: 'x' } })],
    ['null entry', () => [null]],
    ['array entry', () => [[]]],
    ['missing params', () => [{}]],
    ['empty params', () => [{ params: {} }]],
    ['array params', () => [{ params: [] }]],
    ['invalid param type', () => [{ params: { slug: 42 } }]],
    ['missing required param', () => [{ params: { other: 'x' } }]],
    ['undefined required param', () => [{ params: { slug: undefined } }]],
  ])('rejects invalid getStaticPaths output: %s', async (_name, getStaticPaths) => {
    await expect(discoverRuntimeDynamicPaths(runtime(), source([
      loader({ getStaticPaths }),
    ]))).rejects.toBeInstanceOf(RuntimeDynamicRouteDiscoveryError);
  });

  test('sanitizes source, loader, export, and getStaticPaths failures', async () => {
    const secret = 'SECRET_DYNAMIC_ROUTE_VALUE';
    const cases = [
      { mode: 'startup', load: async () => { throw new Error(secret); } },
      { mode: 'hot', load: async () => ({ list: () => { throw new Error(secret); } }) },
      source([loader({ load: async () => { throw new Error(secret); } })]),
      source([loader({ load: async () => ({}) })]),
      source([loader({ getStaticPaths: () => { throw new Error(secret); } })]),
    ];
    for (const dynamicSource of cases) {
      let error;
      try {
        await discoverRuntimeDynamicPaths(runtime(), dynamicSource);
      } catch (value) {
        error = value;
      }
      expect(error).toBeInstanceOf(RuntimeDynamicRouteDiscoveryError);
      expect(error.message).not.toContain(secret);
      expect(error.cause).toBeUndefined();
    }
  });

  test('sanitizes proxy failures while snapshotting inventory and route results', async () => {
    const secret = 'SECRET_PROXY_ITERATOR_VALUE';
    const throwingArray = () => new Proxy([], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error(secret);
        return Reflect.get(target, property, receiver);
      },
    });
    const cases = [
      { mode: 'startup', load: async () => ({ list: () => throwingArray() }) },
      source([loader({ getStaticPaths: () => throwingArray() })]),
    ];
    for (const dynamicSource of cases) {
      let error;
      try {
        await discoverRuntimeDynamicPaths(runtime(), dynamicSource);
      } catch (value) {
        error = value;
      }
      expect(error).toBeInstanceOf(RuntimeDynamicRouteDiscoveryError);
      expect(error.message).not.toContain(secret);
      expect(error.cause).toBeUndefined();
    }
  });

  test('recommends startup when the experimental hot inventory fails', async () => {
    await expect(discoverRuntimeDynamicPaths(runtime(), {
      mode: 'hot',
      load: async () => { throw new Error('private shape changed'); },
    })).rejects.toThrow(/devDynamicDiscovery: "startup"/);
  });
});

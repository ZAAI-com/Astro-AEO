import { test, expect, describe, vi } from 'vitest';
import {
  absoluteUrl,
  basePrefix,
  buildPage,
  mdHrefFor,
  mdPathnameFor,
  pagePathForMdPath,
  urlPath,
} from './page-model.js';
import { resolveConfig } from '../config.js';

const site = { siteUrl: 'https://x.com', base: '', trailingSlash: 'always' };
const page = (body, head = '') =>
  `<!doctype html><html><head><title>T</title>${head}</head><body><main>${body}</main></body></html>`;

describe('URL helpers', () => {
  test('urlPath honours trailingSlash, and root is always "/"', () => {
    expect(urlPath('/', 'always')).toBe('/');
    expect(urlPath('/', 'never')).toBe('/');
    expect(urlPath('/a', 'always')).toBe('/a/');
    expect(urlPath('/a', 'ignore')).toBe('/a/');
    expect(urlPath('/a', 'never')).toBe('/a');
  });

  test('basePrefix treats "" and "/" alike and trims a trailing slash', () => {
    expect(basePrefix('')).toBe('');
    expect(basePrefix('/')).toBe('');
    expect(basePrefix('/docs')).toBe('/docs');
    expect(basePrefix('/docs/')).toBe('/docs');
  });

  test('absoluteUrl composes origin, base and path', () => {
    expect(absoluteUrl('https://x.com', '/docs', '/a', 'always')).toBe('https://x.com/docs/a/');
    expect(absoluteUrl('https://x.com', '', '/', 'never')).toBe('https://x.com/');
  });

  test('mdPathnameFor and pagePathForMdPath are inverses', () => {
    for (const pathname of ['/', '/a', '/blog/post']) {
      expect(pagePathForMdPath(mdPathnameFor(pathname))).toBe(pathname);
    }
  });

  test('pagePathForMdPath rejects anything that is not a companion', () => {
    expect(pagePathForMdPath('/about')).toBeNull();
    expect(pagePathForMdPath('/about.html')).toBeNull();
    expect(pagePathForMdPath('/readme.markdown')).toBeNull();
  });

  test('mdHrefFor is base-prefixed', () => {
    expect(mdHrefFor('/a', '/docs')).toBe('/docs/a.md');
    expect(mdHrefFor('/', '')).toBe('/index.md');
  });
});

describe('buildPage', () => {
  const config = resolveConfig();

  test('produces a normalized record from rendered HTML', async () => {
    const result = await buildPage({
      pathname: '/about/',
      html: page(
        '<h1>About</h1><p>Body.</p>',
        '<meta name="description" content="Desc."><meta name="aeo" content="no-dotmd, no-llms">',
      ),
      config,
      site,
    });
    expect('page' in result).toBe(true);
    const { page: p } = result;
    expect(p.pathname).toBe('/about');
    expect(p.url).toBe('https://x.com/about/');
    expect(p.mdHref).toBe('/about.md');
    expect(p.title).toBe('T');
    expect(p.description).toBe('Desc.');
    expect(p.markdown).toBe('# About\n\nBody.');
    expect(p.rendering).toBe('on-demand');
    expect(p.aeoTokens).toEqual(['no-dotmd', 'no-llms']);
    expect(p).toMatchObject({
      id: '/about',
      canonicalUrl: 'https://x.com/about/',
      markdownUrl: 'https://x.com/about.md',
      metadata: { title: 'T', description: 'Desc.', canonicalSource: 'inferred' },
      representations: { markdown: '# About\n\nBody.', plainText: 'About Body.' },
      authors: [],
      entities: [],
      directives: {
        index: true,
        includeInLlms: false,
        includeInLlmsFull: true,
        generateMarkdown: false,
      },
    });
    expect(p.source).toEqual({ kind: 'rendered', strategy: 'rendered' });
    expect(p.diagnostics).toEqual([]);
    expect(p.extraction?.strategy).toBe('main');
    expect(() => JSON.stringify(p)).not.toThrow();
  });

  test('omits non-content element text from the plain-text representation', async () => {
    const result = await buildPage({
      pathname: '/plain-text',
      html: page(
        '<h1>Visible</h1>' +
        '<script>SECRET_SCRIPT</script>' +
        '<style>SECRET_STYLE</style>' +
        '<noscript>SECRET_NOSCRIPT</noscript>' +
        '<template>SECRET_TEMPLATE</template>' +
        '<iframe>SECRET_FRAME</iframe>' +
        '<p>Body.</p>',
      ),
      config,
      site,
    });

    expect(result.page.representations.plainText).toBe('Visible Body.');
  });

  test('every skip is reported with a reason rather than silently dropped', async () => {
    const excluded = await buildPage({
      pathname: '/private/x',
      html: page('<p>x</p>'),
      config: resolveConfig({ pages: { exclude: ['/private/**'] } }),
      site,
    });
    expect(excluded).toEqual({ skip: 'excluded' });

    const redirect = await buildPage({
      pathname: '/old',
      html: page('<p>x</p>', '<meta http-equiv="refresh" content="0;url=/new/">'),
      config,
      site,
    });
    expect(redirect).toEqual({ skip: 'redirect' });

    const noindex = await buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="robots" content="noindex">'),
      config,
      site,
    });
    expect(noindex).toEqual({ skip: 'noindex' });

    const token = await buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="aeo" content="skip">'),
      config,
      site,
    });
    expect(token).toEqual({ skip: 'skip-token' });
  });

  test('respectNoindex: false keeps a noindex page', async () => {
    const result = await buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="robots" content="noindex">'),
      config: resolveConfig({ pages: { respectNoindex: false } }),
      site,
    });
    expect('page' in result).toBe(true);
  });

  test('relative links resolve against the page URL the record itself carries', async () => {
    const result = await buildPage({
      pathname: '/blog/post',
      html: page('<a href="../other/">Other</a>'),
      config,
      site,
    });
    expect(result.page.markdown).toContain('(https://x.com/blog/other/)');
  });

  test('article:modified_time becomes lastModified, and is otherwise undefined', async () => {
    const dated = await buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta property="article:modified_time" content="2026-02-15">'),
      config,
      site,
    });
    expect(dated.page.lastModified).toBe('2026-02-15T00:00:00.000Z');

    const undated = await buildPage({ pathname: '/x', html: page('<p>x</p>'), config, site });
    expect(undated.page.lastModified).toBeUndefined();
  });

  test('uses authored Markdown without initializing Turndown', async () => {
    let loads = 0;
    const marker =
      '<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>' +
      '{"markdown":"# Authored\\n\\nExact source.","sourcePath":"src/content/authored.md"}' +
      '</script>';
    const result = await buildPage({
      pathname: '/authored',
      html: page(`${marker}<h1>Rendered</h1>`),
      config,
      site,
      getTurndown: async () => {
        loads++;
        throw new Error('Turndown must not load');
      },
    });

    expect(result.page.markdown).toBe('# Authored\n\nExact source.');
    expect(result.page.source).toEqual({
      kind: 'markdown',
      strategy: 'marker',
      path: 'src/content/authored.md',
    });
    expect(result.page.extraction).toBeUndefined();
    expect(loads).toBe(0);
  });

  test('preserves explicitly empty authored Markdown without initializing Turndown', async () => {
    let loads = 0;
    const result = await buildPage({
      pathname: '/empty-source',
      html: page('<h1>Rendered fallback</h1>'),
      config,
      site,
      authored: { markdown: '' },
      getTurndown: async () => {
        loads++;
        throw new Error('Turndown must stay lazy');
      },
    });
    expect(result.page.markdown).toBe('');
    expect(result.page.source).toEqual({ kind: 'custom', strategy: 'markdown-route' });
    expect(result.page.extraction).toBeUndefined();
    expect(loads).toBe(0);
  });

  test('an explicitly empty marker owns provenance over a catalog source', async () => {
    const marker =
      '<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>' +
      '{"markdown":"","sourcePath":"marker-empty.md"}' +
      '</script>';
    const extraction = {
      strategy: 'cms',
      selectedNodes: 1,
      removedNodes: 0,
      inputCharacters: 10,
      outputCharacters: 8,
    };
    const result = await buildPage({
      pathname: '/empty-marker',
      html: page(`${marker}<h1>Rendered fallback</h1>`),
      config,
      site,
      authored: {
        markdown: '# Catalog',
        path: 'catalog.md',
        strategy: 'catalog',
        extraction,
      },
    });

    expect(result.page.markdown).toBe('');
    expect(result.page.source).toEqual({ kind: 'markdown', strategy: 'marker', path: 'marker-empty.md' });
    expect(result.page.extraction).toBeUndefined();
  });

  test('preserves authored whitespace, catalog diagnostics, and marker source paths', async () => {
    const extraction = {
      strategy: 'cms',
      selectedNodes: 1,
      removedNodes: 2,
      inputCharacters: 20,
      outputCharacters: 12,
      fallbackReason: undefined,
    };
    const marker =
      '<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>' +
      '{"sourcePath":"cms:marker-only"}' +
      '</script>';
    const result = await buildPage({
      pathname: '/catalog',
      html: page(`${marker}<h1>Rendered</h1>`),
      config,
      site,
      authored: { markdown: '\n# Exact source\n', extraction, strategy: 'catalog' },
    });
    expect(result.page.markdown).toBe('\n# Exact source\n');
    expect(result.page.extraction).toEqual(extraction);
    expect(result.page.source).toEqual({ kind: 'custom', strategy: 'catalog', path: 'cms:marker-only' });
  });

  test('an explicit page marker wins over catalog or standalone source', async () => {
    const marker =
      '<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>' +
      '{"markdown":"# Marker","title":"Marker title","sourcePath":"marker.md"}' +
      '</script>';
    const result = await buildPage({
      pathname: '/authored',
      html: page(`${marker}<h1>Rendered</h1>`),
      config,
      site,
      authored: {
        markdown: '# Catalog',
        title: 'Catalog title',
        path: 'catalog.md',
        strategy: 'catalog',
      },
    });
    expect(result.page).toMatchObject({
      markdown: '# Marker',
      title: 'Marker title',
      source: { strategy: 'marker', path: 'marker.md' },
    });
  });

  test('runs renderers only after exact authored Markdown and before DOM extraction', async () => {
    const exactRenderer = { name: 'must-not-run', render: vi.fn() };
    const exact = await buildPage({
      pathname: '/exact',
      html: page('<h1>Rendered</h1>'),
      config,
      site,
      authored: { markdown: '# Exact' },
      renderers: [exactRenderer],
    });
    expect(exact.page.markdown).toBe('# Exact');
    expect(exactRenderer.render).not.toHaveBeenCalled();

    const fallbackLoader = vi.fn(async () => { throw new Error('DOM extraction must stay lazy'); });
    const rendered = await buildPage({
      pathname: '/mdx',
      html: page('<h1>Rendered fallback</h1>'),
      config,
      site,
      authored: {
        body: '# Authored MDX',
        kind: 'mdx',
        path: 'src/pages/mdx.mdx',
        hash: 'sha256:authored-mdx',
      },
      routePattern: '/[slug]',
      renderers: [{
        name: 'source-aware',
        render(input) {
          expect(input.source).toEqual({
            kind: 'mdx',
            path: 'src/pages/mdx.mdx',
            body: '# Authored MDX',
            hash: 'sha256:authored-mdx',
          });
          expect(input.canonicalUrl).toBe('https://x.com/mdx/');
          expect(input.routePattern).toBe('/[slug]');
          return { status: 'rendered', markdown: '' };
        },
      }],
      getTurndown: fallbackLoader,
    });
    expect(rendered.page.markdown).toBe('');
    expect(rendered.page.extraction).toMatchObject({ strategy: 'renderer:source-aware' });
    expect(rendered.page.source.hash).toBe('sha256:authored-mdx');
    expect(fallbackLoader).not.toHaveBeenCalled();
  });

  test('continues to rendered HTML after renderer diagnostics or fallback requests', async () => {
    const result = await buildPage({
      pathname: '/fallback',
      html: page('<h1>Rendered fallback</h1><p>Body.</p>'),
      config,
      site,
      renderers: [{
        name: 'unsupported',
        render: () => ({
          status: 'fallback-to-html',
          diagnostics: [{ code: 'unsupported-source', message: 'Use the HTML.' }],
        }),
      }],
    });
    expect(result.page.markdown).toBe('# Rendered fallback\n\nBody.');
    expect(result.page.diagnostics).toEqual([
      expect.objectContaining({ code: 'unsupported-source', pathname: '/fallback' }),
    ]);
    expect(result.page.extraction?.strategy).toBe('main');
  });
});

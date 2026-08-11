import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { serializeJsonLd } from '../lib/serialize-jsonld.js';
import { enrichHtmlHead } from './head.js';

const site = { siteUrl: 'https://example.com', base: '', trailingSlash: 'never' };

function page(overrides = {}) {
  return {
    id: '/about', pathname: '/about', rendering: 'prerendered',
    url: 'https://example.com/about', canonicalUrl: 'https://example.com/about',
    mdHref: '/about.md', markdownUrl: 'https://example.com/about.md',
    title: 'About', description: 'Description', markdown: '# About', aeoTokens: [],
    metadata: { title: 'About', description: 'Description', canonicalSource: 'inferred' },
    representations: { html: '', markdown: '# About', plainText: 'About' },
    authors: [], entities: [],
    directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    source: { kind: 'rendered', strategy: 'rendered' }, diagnostics: [],
    ...overrides,
  };
}

function document(head = '', body = '<main>About</main>') {
  return `<!doctype html><html><head><title>About</title>${head}</head><body>${body}</body></html>`;
}

function marker(value) {
  return `<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>${serializeJsonLd(value)}</script>`;
}

describe('managed page head', () => {
  test('default configuration injects one deterministic managed graph', () => {
    const result = enrichHtmlHead({ html: document(), page: page(), config: resolveConfig(), site });
    expect(result.html.match(/data-astro-aeo-graph/g)).toHaveLength(1);
    expect(result.html).toContain('"@type":"WebPage"');
    expect(result.html).toContain('"@type":"WebSite"');
  });

  test('global injection can be disabled without disabling an explicit AeoHead', () => {
    const config = resolveConfig({ schema: { autoInject: false } });
    expect(enrichHtmlHead({ html: document(), page: page(), config, site }).html)
      .not.toContain('data-astro-aeo-graph');

    const explicit = enrichHtmlHead({
      html: document(marker({ title: 'Owned', graph: { '@type': 'Article', headline: 'Evidence' } })),
      page: page(), config, site,
    });
    expect(explicit.html).toContain('<title>Owned</title>');
    expect(explicit.html).toContain('"@type":"Article"');
    expect(explicit.html).not.toContain('data-astro-aeo-head');
  });

  test('an empty explicit AeoHead still owns graph output when global injection is disabled', () => {
    const result = enrichHtmlHead({
      html: document(marker({})),
      page: page(),
      config: resolveConfig({ schema: { autoInject: false } }),
      site,
    });
    expect(result.explicit).toBe(true);
    expect(result.html).toContain('data-astro-aeo-graph');
    expect(result.html).not.toContain('data-astro-aeo-head');
  });

  test('infer=false retains explicit graph and suppresses inferred site/page nodes', () => {
    const result = enrichHtmlHead({
      html: document(marker({ infer: false, graph: { '@type': 'Article', headline: 'Only' } })),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain('"@type":"Article"');
    expect(result.html).not.toContain('"@type":"WebPage"');
    expect(result.html).not.toContain('"@type":"WebSite"');
  });

  test('explicit canonical owns precedence and relative metadata URLs resolve against it', () => {
    const result = enrichHtmlHead({
      html: document(`<link rel="canonical" href="https://example.com/authored">${marker({
        canonical: '/explicit', openGraph: { images: ['/image.jpg'] },
      })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.canonicalUrl).toBe('https://example.com/explicit');
    expect(result.html).not.toContain('https://example.com/authored');
    expect(result.html).toContain('content="https://example.com/image.jpg"');
  });

  test('missing stable canonical preserves the page, strips the marker, and skips graph output', () => {
    const result = enrichHtmlHead({
      html: document(marker({ graph: { '@type': 'Article', headline: 'No identity' } })),
      page: page({ url: '/about', canonicalUrl: undefined, markdownUrl: undefined }),
      config: resolveConfig(),
      site: { ...site, siteUrl: '' },
    });
    expect(result.html).not.toContain('data-astro-aeo-head');
    expect(result.html).not.toContain('data-astro-aeo-graph');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'managed-graph-canonical-missing' }));
  });

  test('reports one canonical warning when an explicit value has no stable fallback', () => {
    const result = enrichHtmlHead({
      html: document(marker({ canonical: 'http://localhost/private', graph: { '@type': 'Thing' } })),
      page: page({ url: '/about', canonicalUrl: undefined, markdownUrl: undefined }),
      config: resolveConfig(),
      site: { ...site, siteUrl: '' },
    });
    expect(result.diagnostics.filter(({ code }) =>
      code === 'canonical-invalid' || code === 'managed-graph-canonical-missing')).toHaveLength(1);
  });

  test('renders every explicit metadata family including plural authors and Twitter media', () => {
    const result = enrichHtmlHead({
      html: document(marker({
        title: 'Owned',
        description: 'Owned description',
        canonical: '/owned',
        robots: ['index', 'follow'],
        locale: 'en_US',
        openGraph: { type: 'article', images: [{ url: '/cover.jpg', alt: 'Cover' }] },
        twitter: {
          card: 'player',
          player: { url: '/player', width: 640, height: 360, stream: '/stream.mp4' },
          apps: [{ platform: 'iphone', name: 'Example', id: '123', url: '/app' }],
        },
        hreflang: [{ lang: 'de', href: '/de/owned' }],
        feeds: [{ href: '/feed.xml', type: 'application/rss+xml', title: 'Feed' }],
        pagination: { previous: '/one', next: '/three' },
        markdownAlternate: { href: '/owned.md', title: 'Markdown' },
        themeColor: [{ color: '#fff', media: '(prefers-color-scheme: light)' }],
        authors: [{ name: 'Ada', url: '/people/ada' }],
      })),
      page: page(), config: resolveConfig(), site,
    });

    for (const expected of [
      '<title>Owned</title>',
      'name="robots" content="index, follow"',
      'property="og:locale" content="en_US"',
      'property="og:image" content="https://example.com/cover.jpg"',
      'name="twitter:player:width" content="640"',
      'name="twitter:app:id:iphone" content="123"',
      'hreflang="de" href="https://example.com/de/owned"',
      'type="application/rss+xml" href="https://example.com/feed.xml"',
      'rel="prev" href="https://example.com/one"',
      'type="text/markdown" href="https://example.com/owned.md"',
      'name="theme-color" content="#fff"',
      'name="author" content="Ada"',
      'rel="author" href="https://example.com/people/ada"',
    ]) expect(result.html).toContain(expected);
  });

  test('fills only absent metadata from page facts and explicit defaults', () => {
    const config = resolveConfig({
      metadata: {
        fillMissing: true,
        defaults: {
          title: 'Default title',
          description: 'Default description',
          robots: 'index, follow',
          openGraph: { type: 'article', image: '/default.jpg' },
          twitter: { card: 'summary', site: '@example' },
          locale: 'en_US',
          themeColor: '#123456',
          author: { name: 'Configured author', url: '/author' },
        },
      },
    });
    const result = enrichHtmlHead({
      html: '<!doctype html><html><head><meta property="og:title" content="Authored"></head><body>About</body></html>',
      page: page(), config, site,
    });
    expect(result.html.match(/property="og:title"/g)).toHaveLength(1);
    expect(result.html).toContain('property="og:title" content="Authored"');
    expect(result.html).toContain('property="og:description" content="Description"');
    expect(result.html).toContain('property="og:type" content="article"');
    expect(result.html).toContain('name="twitter:card" content="summary"');
    expect(result.html).toContain('name="robots" content="index, follow"');
    expect(result.html).toContain('name="theme-color" content="#123456"');
    expect(result.html).toContain('name="author" content="Configured author"');
  });

  test('authored JSON-LD bytes remain stable and suppress duplicate managed facts', () => {
    const authored = '<script type="application/ld+json"> { "@id":"https://example.com/about#webpage", "@type":"WebPage", "name":"Authored" } </script>';
    const result = enrichHtmlHead({ html: document(authored), page: page(), config: resolveConfig(), site });
    expect(result.html).toContain(authored);
    expect(result.html.match(/"name":"Authored"/g)).toHaveLength(1);
    expect(result.graph?.entries.find(({ entity }) => entity['@id'] === 'https://example.com/about#webpage')?.entity)
      .not.toHaveProperty('name');
    expect(result.normalizedGraph?.entries.find(({ entity }) => entity['@id'] === 'https://example.com/about#webpage')?.entity)
      .toMatchObject({ '@type': 'WebPage', name: 'Authored', description: 'Description' });
  });

  test('authored graph forms and anonymous entities join only the normalized graph', () => {
    const authored = '<script type="application/ld+json"> { "@context":"https://schema.org", "@graph":[{"@id":"https://example.com/about#webpage","@type":"WebPage","name":"Authored"},{"@type":"Thing","name":"Anonymous"}] } </script>';
    const result = enrichHtmlHead({ html: document(authored), page: page(), config: resolveConfig(), site });
    expect(result.html).toContain(authored);
    expect(result.normalizedGraph?.entries.map(({ entity }) => entity)).toEqual(expect.arrayContaining([
      expect.objectContaining({ '@id': 'https://example.com/about#webpage', name: 'Authored' }),
      expect.objectContaining({ '@type': 'Thing', name: 'Anonymous' }),
    ]));
    expect(result.graph?.entries.some(({ entity }) => entity.name === 'Anonymous')).toBe(false);
  });

  test('emits an empty managed delta when authored JSON-LD already owns every fact', () => {
    const entity = { '@id': 'https://example.com/about#article', '@type': 'Article', headline: 'Authored' };
    const authored = `<script type="application/ld+json">${JSON.stringify(entity)}</script>`;
    const result = enrichHtmlHead({
      html: document(`${authored}${marker({ infer: false, graph: entity })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain(authored);
    expect(result.html).toContain('data-astro-aeo-graph>{"@context":"https://schema.org","@graph":[]}</script>');
    expect(result.graph?.entries).toEqual([]);
    expect(result.normalizedGraph?.entries).toHaveLength(1);
  });

  test('malformed authored JSON-LD warns and is omitted from the normalized graph', () => {
    const malformed = '<script type="application/ld+json">{"@type":"Thing",}</script>';
    const result = enrichHtmlHead({ html: document(malformed), page: page(), config: resolveConfig(), site });
    expect(result.html).toContain(malformed);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'authored-jsonld-malformed', severity: 'warning',
    }));
    expect(result.normalizedGraph?.entries.some(({ entity }) => entity['@type'] === 'Thing')).toBe(false);
  });

  test('multiple AeoHead markers diagnose and the first owns output', () => {
    const result = enrichHtmlHead({
      html: document(`${marker({ title: 'First' })}${marker({ title: 'Second' })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain('<title>First</title>');
    expect(result.html).not.toContain('Second');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'aeo-head-multiple', severity: 'error' }));
  });

  test('breadcrumb inference requires linked authored evidence', () => {
    const none = enrichHtmlHead({ html: document(), page: page(), config: resolveConfig(), site });
    expect(none.html).not.toContain('BreadcrumbList');
    const evidence = document('', '<nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/about">About</a></nav>');
    const withBreadcrumbs = enrichHtmlHead({ html: evidence, page: page(), config: resolveConfig(), site });
    expect(withBreadcrumbs.html).toContain('BreadcrumbList');
    expect(withBreadcrumbs.html).toContain('"name":"Home"');
  });
});

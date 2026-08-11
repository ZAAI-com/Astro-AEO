import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { serializeJsonLd } from '../lib/serialize-jsonld.js';
import { enrichHtmlHead, stripAeoHeadMarkers } from './head.js';

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
    expect(result.graph?.entries.find(({ entity }) => entity['@type'] === 'WebPage')).toMatchObject({
      roles: ['page'],
      provenance: [{ source: 'inference', pathname: '/about' }],
    });
  });

  test('preserves explicit graph roles and provenance outside serialized JSON-LD', () => {
    const result = enrichHtmlHead({
      html: document(marker({
        infer: false,
        graph: {
          version: 1,
          entries: [{
            entity: { '@type': 'Article', headline: 'Evidence' },
            roles: ['page'],
            provenance: [{ source: 'plugin', plugin: 'evidence' }],
          }],
          conflicts: [],
        },
      })),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.graph?.entries[0]).toMatchObject({
      roles: ['page'],
      provenance: [{ source: 'plugin', plugin: 'evidence' }],
    });
    expect(result.html).not.toContain('provenance');
    expect(result.html).not.toContain('roles');
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

  test('resolves a relative explicit canonical against the configured site, not an authored origin', () => {
    const result = enrichHtmlHead({
      html: document(`<link rel="canonical" href="https://other.example/authored">${marker({
        canonical: '/explicit', openGraph: { images: ['/image.jpg'] },
      })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.canonicalUrl).toBe('https://example.com/explicit');
    expect(result.html).not.toContain('other.example');
    expect(result.html).toContain('content="https://example.com/image.jpg"');
  });

  test('does not resolve a relative explicit canonical from an authored origin without a site', () => {
    const result = enrichHtmlHead({
      html: document(`<link rel="canonical" href="https://other.example/authored">${marker({
        canonical: '/explicit',
      })}`),
      page: page({
        url: '/',
        canonicalUrl: undefined,
        markdownUrl: undefined,
        metadata: { title: 'Page' },
      }),
      config: resolveConfig(),
      site: { ...site, siteUrl: '' },
    });

    expect(result.canonicalUrl).toBe('https://other.example/authored');
    expect(result.canonicalUrl).not.toBe('https://other.example/explicit');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'canonical-invalid' }));
  });

  test('preserves the encoded spelling of an inferred page canonical', () => {
    const result = enrichHtmlHead({
      html: document(),
      page: page({
        id: '/sale-100%',
        pathname: '/sale-100%',
        url: 'https://example.com/sale-100%25',
        canonicalUrl: 'https://example.com/sale-100%25',
        mdHref: '/sale-100%25.md',
        markdownUrl: 'https://example.com/sale-100%25.md',
      }),
      config: resolveConfig(),
      site,
    });
    expect(result.canonicalUrl).toBe('https://example.com/sale-100%25');
    expect(result.graph?.entries.find(({ entity }) => entity['@type'] === 'WebPage')?.entity)
      .toMatchObject({
        '@id': 'https://example.com/sale-100%25#webpage',
        url: 'https://example.com/sale-100%25',
      });
  });

  test('explicit head facts become the effective page and inferred WebPage facts', () => {
    const result = enrichHtmlHead({
      html: document(marker({
        title: 'Explicit title',
        description: 'Explicit description',
        canonical: '/explicit',
        locale: 'de-DE',
      })),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.page).toMatchObject({
      url: 'https://example.com/explicit',
      canonicalUrl: 'https://example.com/explicit',
      title: 'Explicit title',
      description: 'Explicit description',
      language: 'de-DE',
      metadata: {
        title: 'Explicit title',
        description: 'Explicit description',
        canonicalSource: 'authored',
      },
    });
    expect(result.graph?.entries.find(({ entity }) => entity['@type'] === 'WebPage')?.entity)
      .toMatchObject({ name: 'Explicit title', description: 'Explicit description', inLanguage: 'de-DE' });
  });

  test('targeted metadata edits preserve tag-like authored script bytes', () => {
    const json = '<script type="application/ld+json">{"@type":"Thing","name":"<title>Literal</title><meta name=description>"}</script>';
    const ordinary = '<script>const literal = "<meta property=og:title>"; const close = "</head>";</script>';
    const result = enrichHtmlHead({
      html: document(`${json}${ordinary}${marker({
        title: 'Owned', description: 'Owned description', openGraph: { title: 'Owned OG' },
      })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain(json);
    expect(result.html).toContain(ordinary);
    expect(result.html).toContain('<title>Owned</title>');
    expect(result.html).toContain('property="og:title" content="Owned OG"');
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

  test('treats a null Markdown alternate as absent metadata', () => {
    const result = enrichHtmlHead({
      html: document(`<link rel="alternate" type="text/markdown" href="/authored.md">${marker({
        markdownAlternate: null,
      })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain('/authored.md');
    expect(result.html).toContain('type="text/markdown"');
  });

  test.each(['de_DE', 42])('ignores a non-array Open Graph localeAlternates value: %j', (localeAlternates) => {
    const result = enrichHtmlHead({
      html: document(marker({ openGraph: { localeAlternates } })),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).not.toContain('og:locale:alternate');
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

  test('diagnoses duplicate and conflicting singleton metadata without exposing values', () => {
    const result = enrichHtmlHead({
      html: document(
        '<title>Second title</title>' +
        '<meta name="description" content="first-secret">' +
        '<meta name="description" content="second-secret">' +
        '<meta name="robots" content="index">' +
        '<meta name="robots" content="index">',
      ),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'metadata-duplicate', message: expect.stringContaining('title') }),
      expect.objectContaining({ code: 'metadata-conflict', message: expect.stringContaining('name:description') }),
      expect.objectContaining({ code: 'metadata-duplicate', message: expect.stringContaining('name:robots') }),
    ]));
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/first-secret|second-secret/);
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

  test('authored same-page facts outrank inferred facts without requiring a matching ID', () => {
    const authored = '<script type="application/ld+json">{"@type":"WebPage","url":"https://example.com/about","name":"Authored","description":"Description"}</script>';
    const result = enrichHtmlHead({ html: document(authored), page: page(), config: resolveConfig(), site });
    expect(result.html).toContain(authored);
    expect(result.graph?.entries.some(({ entity }) => entity['@type'] === 'WebPage')).toBe(false);
    expect(result.normalizedGraph?.entries.some(({ entity }) => entity.name === 'Authored')).toBe(true);
  });

  test('extends a matching user-authored WebPage ID instead of creating a default ID', () => {
    const authored = '<script type="application/ld+json">{"@id":"https://example.com/about#owned-page","@type":"WebPage","url":"https://example.com/about","name":"Authored"}</script>';
    const result = enrichHtmlHead({ html: document(authored), page: page(), config: resolveConfig(), site });
    const managedPage = result.graph?.entries.find(({ entity }) => entity['@type'] === 'WebPage')?.entity;
    expect(managedPage).toMatchObject({
      '@id': 'https://example.com/about#owned-page',
      '@type': 'WebPage',
      description: 'Description',
    });
    expect(result.html).not.toContain('https://example.com/about#webpage');
  });

  test('managed entities can reference unchanged authored entities on the same page', () => {
    const authored = '<script type="application/ld+json">{"@id":"https://example.com/about#author","@type":"Person","name":"Ada"}</script>';
    const result = enrichHtmlHead({
      html: document(`${authored}${marker({
        infer: false,
        graph: {
          '@id': '#article',
          '@type': 'Article',
          headline: 'Evidence',
          author: { '@id': '#author' },
        },
      })}`),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).toContain(authored);
    expect(result.html).toContain('https://example.com/about#article');
    expect(result.graph?.entries[0].entity.author).toEqual({ '@id': 'https://example.com/about#author' });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'schema.unresolved-reference' }));
  });

  test('surfaces sanitized graph finding codes and pointers', () => {
    const result = enrichHtmlHead({
      html: document(marker({
        infer: false,
        graph: {
          '@id': '#article',
          '@type': 'Article',
          author: { '@id': '#missing' },
        },
      })),
      page: page(), config: resolveConfig(), site,
    });
    expect(result.html).not.toContain('data-astro-aeo-graph');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'schema.unresolved-reference',
      severity: 'error',
      details: { pointer: '/entries/0/entity/author/@id' },
    }));
    expect(JSON.stringify(result.diagnostics)).not.toContain('#missing');
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

  test('does not treat marker-like text inside a script as an internal marker', () => {
    const html = document('<script>const example = "<script data-astro-aeo-head>";</script>');
    expect(stripAeoHeadMarkers(html)).toBe(html);
    const result = enrichHtmlHead({ html, page: page(), config: resolveConfig(), site });
    expect(result.explicit).toBe(false);
    expect(result.html).toContain('const example');
  });

  test('does not treat a marker name inside another attribute value as a marker', () => {
    const html = document('<script data-example=" data-astro-aeo-head ">console.log(1)</script>');
    expect(stripAeoHeadMarkers(html)).toBe(html);
    expect(enrichHtmlHead({ html, page: page(), config: resolveConfig(), site }).explicit).toBe(false);
  });

  test('breadcrumb inference requires linked authored evidence', () => {
    const none = enrichHtmlHead({ html: document(), page: page(), config: resolveConfig(), site });
    expect(none.html).not.toContain('BreadcrumbList');
    const evidence = document('', '<nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/about">About</a></nav>');
    const withBreadcrumbs = enrichHtmlHead({ html: evidence, page: page(), config: resolveConfig(), site });
    expect(withBreadcrumbs.html).toContain('BreadcrumbList');
    expect(withBreadcrumbs.html).toContain('"name":"Home"');

    const incomplete = document('', '<nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/products">Products</a><span>About</span></nav>');
    expect(enrichHtmlHead({ html: incomplete, page: page(), config: resolveConfig(), site }).html)
      .not.toContain('BreadcrumbList');
  });

  test('uses complete catalog ancestry without deriving labels from the URL', () => {
    const result = enrichHtmlHead({
      html: document(),
      page: page(),
      config: resolveConfig(),
      site,
      breadcrumbTrail: [
        { name: 'Start page', item: 'https://example.com/' },
        { name: 'Authored about title', item: 'https://example.com/about' },
      ],
    });

    expect(result.html).toContain('BreadcrumbList');
    expect(result.html).toContain('"name":"Start page"');
    expect(result.html).toContain('"name":"Authored about title"');
  });

  test('prefers a complete linked breadcrumb trail over catalog ancestry', () => {
    const linked = document(
      '',
      '<nav aria-label="Breadcrumb"><a href="/">Linked home</a><a href="/about">Linked about</a></nav>',
    );
    const result = enrichHtmlHead({
      html: linked,
      page: page(),
      config: resolveConfig(),
      site,
      breadcrumbTrail: [
        { name: 'Catalog home', item: 'https://example.com/' },
        { name: 'Catalog about', item: 'https://example.com/about' },
      ],
    });

    expect(result.html).toContain('"name":"Linked home"');
    expect(result.html).toContain('"name":"Linked about"');
    expect(result.html).not.toContain('Catalog home');
  });
});

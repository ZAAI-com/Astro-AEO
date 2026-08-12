import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createGraph } from '../schema.js';
import { enrichHtmlHead } from './head.js';
import {
  renderSchemaCorpus,
  SCHEMA_MAP_NAMESPACE,
  validateCollectedSchemaGraphs,
} from './schema-corpus.js';

function page(pathname, canonicalUrl) {
  return {
    id: pathname, pathname, rendering: 'prerendered', canonicalUrl,
    url: canonicalUrl, mdHref: `${pathname}.md`, markdown: '', title: pathname, description: '', aeoTokens: [],
    metadata: { title: pathname, canonicalSource: 'authored' }, representations: { markdown: '' },
    authors: [], entities: [], directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    diagnostics: [],
  };
}

describe('schema corpus', () => {
  test('sorts pages/entities and emits the versioned XML mapping', () => {
    const output = renderSchemaCorpus([
      { page: page('/b', 'https://example.com/b'), graph: createGraph({ '@id': 'https://example.com/b#webpage', '@type': 'WebPage', name: 'B' }) },
      { page: page('/a', 'https://example.com/a'), graph: createGraph({ '@id': 'https://example.com/a#article', '@type': 'Article', headline: 'A' }) },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });
    expect(output.map.body).toContain(`xmlns="${SCHEMA_MAP_NAMESPACE}"`);
    expect(output.map.body.indexOf('/a#article')).toBeLessThan(output.map.body.indexOf('/b#webpage'));
    expect(output.graph.body.indexOf('/a#article')).toBeLessThan(output.graph.body.indexOf('/b#webpage'));
  });

  test('keeps distinct page-role entities from every collected document', () => {
    const output = renderSchemaCorpus([
      {
        page: page('/a', 'https://example.com/a'),
        graph: createGraph({
          entity: { '@id': 'https://example.com/a#webpage', '@type': 'WebPage', name: 'A' },
          roles: 'page',
          provenance: { source: 'inference', pathname: '/a' },
        }),
      },
      {
        page: page('/b', 'https://example.com/b'),
        graph: createGraph({
          entity: { '@id': 'https://example.com/b#webpage', '@type': 'WebPage', name: 'B' },
          roles: 'page',
          provenance: { source: 'inference', pathname: '/b' },
        }),
      },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });

    expect(output.graph.body).toContain('https://example.com/a#webpage');
    expect(output.graph.body).toContain('https://example.com/b#webpage');
  });

  test('keeps anonymous entities in JSON-LD and diagnoses their omission from XML', () => {
    const output = renderSchemaCorpus([
      { page: page('/a', 'https://example.com/a'), graph: createGraph({ '@type': 'Thing', name: 'Anonymous' }) },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });
    expect(output.graph.body).toContain('Anonymous');
    expect(output.map.body).not.toContain('Anonymous');
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-map-anonymous-entity' }));
  });

  test('removes characters forbidden by XML 1.0 while preserving valid Unicode', () => {
    const output = renderSchemaCorpus([{
      page: page('/a', 'https://example.com/a\u0000\u000b\ud800\ufffe🧭'),
      graph: createGraph({ '@id': 'https://example.com/a#thing', '@type': 'Thing' }),
    }], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });

    expect(output.map.body).not.toMatch(/[\u0000\u000b\ud800\ufffe]/u);
    expect(output.map.body).toContain('🧭');
  });

  test('resolves collected same-site references and rejects missing same-site targets', () => {
    const resolved = renderSchemaCorpus([
      {
        page: page('/a', 'https://example.com/a'),
        graph: createGraph({
          '@id': 'https://example.com/a#webpage',
          '@type': 'WebPage',
          isPartOf: { '@id': 'https://example.com/#website' },
        }),
      },
      {
        page: page('/', 'https://example.com/'),
        graph: createGraph({ '@id': 'https://example.com/#website', '@type': 'WebSite' }),
      },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });
    expect(resolved.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'schema.unresolved-reference' }),
    );

    expect(() => renderSchemaCorpus([
      {
        page: page('/a', 'https://example.com/a'),
        graph: createGraph({
          '@id': 'https://example.com/a#webpage',
          '@type': 'WebPage',
          isPartOf: { '@id': 'https://example.com/missing#website' },
        }),
      },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' })).toThrow(/validation failed/);
  });

  test('cross-validates collected graphs without requiring corpus emission', () => {
    const referenced = {
      page: page('/a', 'https://example.com/a'),
      graph: createGraph({
        '@id': 'https://example.com/a#webpage',
        '@type': 'WebPage',
        isPartOf: { '@id': 'https://example.com/#website' },
      }),
    };
    const website = {
      page: page('/', 'https://example.com/'),
      graph: createGraph({ '@id': 'https://example.com/#website', '@type': 'WebSite' }),
    };
    expect(validateCollectedSchemaGraphs([referenced, website], {
      siteUrl: 'https://example.com/',
    })).not.toContainEqual(expect.objectContaining({ code: 'schema.unresolved-reference' }));
    expect(validateCollectedSchemaGraphs([referenced], {
      siteUrl: 'https://example.com/',
    })).toContainEqual(expect.objectContaining({
      code: 'schema.unresolved-reference', severity: 'error',
    }));
  });

  test('limits same-site reference checks to the configured Astro base', () => {
    const output = renderSchemaCorpus([{
      page: page('/guide', 'https://example.com/docs/guide'),
      graph: createGraph({
        '@id': 'https://example.com/docs/guide#webpage',
        '@type': 'WebPage',
        isPartOf: { '@id': 'https://example.com/account#website' },
      }),
    }], {
      graphUrl: 'https://example.com/docs/schema/graph.jsonld',
      siteUrl: 'https://example.com/docs/',
    });
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'schema.unresolved-reference' }),
    );
  });

  test('includes anonymous authored entities in the normalized corpus graph', () => {
    const authored = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Thing","name":"Authored anonymous"}</script>';
    const a = page('/a', 'https://example.com/a');
    const enriched = enrichHtmlHead({
      html: `<!doctype html><html><head><title>A</title>${authored}</head><body>A</body></html>`,
      page: a,
      config: resolveConfig({ schema: { corpus: { enabled: true } } }),
      site: { siteUrl: 'https://example.com', base: '', trailingSlash: 'never' },
    });
    expect(enriched.html).toContain(authored);
    expect(enriched.normalizedGraph).not.toBeNull();
    const output = renderSchemaCorpus([
      { page: a, graph: /** @type {import('../schema.js').AeoGraph} */ (enriched.normalizedGraph) },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });
    expect(output.graph.body).toContain('Authored anonymous');
    expect(output.map.body).not.toContain('Authored anonymous');
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-map-anonymous-entity' }));
  });

  test('normalizes explicit fragment IDs before the page graph joins the corpus', () => {
    const a = page('/a', 'https://example.com/a');
    const headMarker = '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{"infer":false,"graph":{"@id":"#article","@type":"Article","headline":"A","image":"cover.jpg"}}</script>';
    const enriched = enrichHtmlHead({
      html: `<!doctype html><html><head><title>A</title>${headMarker}</head><body>A</body></html>`,
      page: a,
      config: resolveConfig({ schema: { corpus: { enabled: true } } }),
      site: { siteUrl: 'https://example.com', base: '', trailingSlash: 'never' },
    });
    expect(enriched.graph?.entries[0].entity['@id']).toBe('https://example.com/a#article');
    expect(enriched.graph?.entries[0].entity.image).toBe('https://example.com/cover.jpg');
    const output = renderSchemaCorpus([
      { page: a, graph: /** @type {import('../schema.js').AeoGraph} */ (enriched.normalizedGraph) },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld', siteUrl: 'https://example.com/' });
    expect(output.graph.body).toContain('https://example.com/a#article');
    expect(output.graph.body).toContain('https://example.com/cover.jpg');
  });

  test('makes malformed authored JSON-LD an error when the schema corpus depends on the page graph', () => {
    const authored = '<script type="application/ld+json">{"@type":"Thing",}</script>';
    const html = `<!doctype html><html><head><title>A</title>${authored}</head><body>A</body></html>`;
    const result = enrichHtmlHead({
      html,
      page: page('/a', 'https://example.com/a'),
      config: resolveConfig({ schema: { corpus: { enabled: true } } }),
      site: { siteUrl: 'https://example.com', base: '', trailingSlash: 'never' },
    });
    expect(result.html).toContain(authored);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'authored-jsonld-malformed', severity: 'error',
    }));
    expect(result.normalizedGraph?.entries.some(({ entity }) => entity['@type'] === 'Thing')).toBe(false);
  });

  test('does not infer a status-page graph solely because corpus output is enabled', () => {
    const statusPage = page('/404', 'https://example.com/404');
    const config = resolveConfig({ schema: { corpus: { enabled: true } } });
    const site = { siteUrl: 'https://example.com', base: '', trailingSlash: 'never' };
    const ordinary = enrichHtmlHead({
      html: '<!doctype html><html><head><title>Not found</title></head><body>Not found</body></html>',
      page: statusPage,
      config,
      site,
      allowGlobal: false,
    });
    expect(ordinary.graph).toBeNull();
    expect(ordinary.normalizedGraph).toBeNull();

    const authored = enrichHtmlHead({
      html: '<!doctype html><html><head><title>Not found</title>' +
        '<script type="application/ld+json">{"@type":"Thing","name":"Authored"}</script>' +
        '</head><body>Not found</body></html>',
      page: statusPage,
      config,
      site,
      allowGlobal: false,
    });
    expect(authored.graph).toBeNull();
    expect(authored.normalizedGraph?.entries[0].entity).toMatchObject({
      '@type': 'Thing',
      name: 'Authored',
    });

    const explicit = enrichHtmlHead({
      html: '<!doctype html><html><head><title>Not found</title>' +
        '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{"infer":false,"graph":{"@type":"Thing","name":"Explicit"}}</script>' +
        '</head><body>Not found</body></html>',
      page: statusPage,
      config,
      site,
      allowGlobal: false,
    });
    expect(explicit.normalizedGraph?.entries).toHaveLength(1);
    expect(explicit.normalizedGraph?.entries[0].entity).toMatchObject({ '@type': 'Thing', name: 'Explicit' });
  });
});

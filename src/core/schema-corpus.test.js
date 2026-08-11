import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createGraph } from '../schema.js';
import { enrichHtmlHead } from './head.js';
import { renderSchemaCorpus, SCHEMA_MAP_NAMESPACE } from './schema-corpus.js';

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
    ], { graphUrl: 'https://example.com/schema/graph.jsonld' });
    expect(output.map.body).toContain(`xmlns="${SCHEMA_MAP_NAMESPACE}"`);
    expect(output.map.body.indexOf('/a#article')).toBeLessThan(output.map.body.indexOf('/b#webpage'));
    expect(output.graph.body.indexOf('/a#article')).toBeLessThan(output.graph.body.indexOf('/b#webpage'));
  });

  test('keeps anonymous entities in JSON-LD and diagnoses their omission from XML', () => {
    const output = renderSchemaCorpus([
      { page: page('/a', 'https://example.com/a'), graph: createGraph({ '@type': 'Thing', name: 'Anonymous' }) },
    ], { graphUrl: 'https://example.com/schema/graph.jsonld' });
    expect(output.graph.body).toContain('Anonymous');
    expect(output.map.body).not.toContain('Anonymous');
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-map-anonymous-entity' }));
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
    ], { graphUrl: 'https://example.com/schema/graph.jsonld' });
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
    ], { graphUrl: 'https://example.com/schema/graph.jsonld' })).toThrow(/validation failed/);
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
    ], { graphUrl: 'https://example.com/schema/graph.jsonld' });
    expect(output.graph.body).toContain('Authored anonymous');
    expect(output.map.body).not.toContain('Authored anonymous');
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-map-anonymous-entity' }));
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
});

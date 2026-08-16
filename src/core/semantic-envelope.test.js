import { describe, expect, test } from 'vitest';
import { createGraph } from '../schema.js';
import { applySemanticGraphPatch, reconcileSemanticEnvelope } from './semantic-envelope.js';

const canonicalUrl = 'https://example.com/page';
const siteUrl = 'https://example.com/';
const authoredEntity = { '@id': `${canonicalUrl}#author`, '@type': 'Person', name: 'Authored' };
const managedEntity = { '@id': `${canonicalUrl}#page`, '@type': 'WebPage', name: 'Original' };
const authoredGraph = createGraph([authoredEntity]);
const managedGraph = createGraph([managedEntity]);
const normalizedGraph = createGraph([authoredEntity, managedEntity]);
const authoredScript = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [authoredEntity] })}</script>`;
const managedScript = '<script type="application/ld+json" data-astro-aeo-graph>{"old":true}</script>';
const html = `<!doctype html><html><head>${authoredScript}${managedScript}</head><body></body></html>`;
const page = {
  id: canonicalUrl,
  pathname: '/page',
  url: canonicalUrl,
  canonicalUrl,
  mdHref: '/page.md',
  markdownUrl: 'https://example.com/page.md',
  rendering: 'prerendered',
  title: 'Page',
  description: '',
  metadata: { title: 'Page', canonicalSource: 'authored' },
  representations: { html, markdown: '# Page' },
  markdown: '# Page',
  authors: [],
  entities: [],
  directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
  aeoTokens: [],
  diagnostics: [],
};
const baseline = { html, graph: managedGraph, normalizedGraph, authoredGraph, canonicalUrl };

describe('semantic graph envelope reconciliation', () => {
  test('derives the combined graph and managed script from a managed-only replacement', () => {
    const replacement = createGraph([{ ...managedEntity, name: 'Replacement' }]);
    const result = reconcileSemanticEnvelope({
      baseline,
      value: { html: html.replace('</head>', '<meta name="plugin" content="yes"></head>'), page, graph: replacement, normalizedGraph },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.html).toContain(authoredScript);
    expect(result.value.html).toContain('<meta name="plugin" content="yes">');
    expect(result.value.html).toContain('Replacement');
    expect(result.value.html).not.toContain('"old":true');
    expect(result.value.normalizedGraph.entries).toHaveLength(2);
  });

  test('derives a managed delta from a normalized-only replacement', () => {
    const faq = { '@id': `${canonicalUrl}#faq`, '@type': 'FAQPage', name: 'Answers' };
    const replacement = createGraph([authoredEntity, managedEntity, faq]);
    const result = reconcileSemanticEnvelope({
      baseline,
      value: { html, page, graph: managedGraph, normalizedGraph: replacement },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph.entries.map(({ entity }) => entity['@id'])).toEqual([
      managedEntity['@id'],
      faq['@id'],
    ]);
    expect(result.value.html).toContain('FAQPage');
    expect(result.value.html).toContain(authoredScript);
  });

  test('rejects inconsistent replacements of both graph views', () => {
    const result = reconcileSemanticEnvelope({
      baseline,
      value: {
        html,
        page,
        graph: createGraph([{ ...managedEntity, name: 'Managed change' }]),
        normalizedGraph: createGraph([authoredEntity, { ...managedEntity, name: 'Different change' }]),
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result).toEqual({
      valid: false,
      diagnostics: [expect.objectContaining({
        code: 'plugin-graph-inconsistent',
        severity: 'error',
        pathname: '/page',
      })],
    });
  });

  test('rejects attempts to mutate authored JSON-LD without leaking plugin values', () => {
    const result = reconcileSemanticEnvelope({
      baseline,
      value: {
        html: html.replace('Authored', 'SECRET AUTHORED REPLACEMENT'),
        page,
        graph: managedGraph,
        normalizedGraph,
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: 'plugin-graph-inconsistent', severity: 'error' }],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  test('derives additive array and nested facts for an authored entity', () => {
    const authored = {
      '@id': `${canonicalUrl}#author`,
      '@type': 'Person',
      name: 'Authored',
      sameAs: ['https://social.example/one'],
      contactPoint: { '@type': 'ContactPoint', email: 'one@example.com' },
    };
    const authoredOnly = createGraph([authored]);
    const localBaseline = {
      html,
      graph: null,
      normalizedGraph: authoredOnly,
      authoredGraph: authoredOnly,
      canonicalUrl,
    };
    const replacement = createGraph([{
      ...authored,
      sameAs: ['https://social.example/one', 'https://social.example/two'],
      contactPoint: {
        ...authored.contactPoint,
        telephone: '+1-555-0100',
      },
    }]);
    const result = reconcileSemanticEnvelope({
      baseline: localBaseline,
      value: { html, page, graph: null, normalizedGraph: replacement },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph.entries[0].entity).toMatchObject({
      '@id': authored['@id'],
      sameAs: ['https://social.example/two'],
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: '+1-555-0100',
      },
    });
    expect(result.value.normalizedGraph.entries[0].entity).toEqual(replacement.entries[0].entity);
  });

  test('derives only additive root types from a normalized-only replacement', () => {
    const replacement = createGraph([{
      ...authoredEntity,
      '@type': ['Person', 'Author'],
    }]);
    const result = reconcileSemanticEnvelope({
      baseline: {
        html,
        graph: null,
        normalizedGraph: authoredGraph,
        authoredGraph,
        canonicalUrl,
      },
      value: { html, page, graph: null, normalizedGraph: replacement },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph.entries[0].entity).toEqual({
      '@id': authoredEntity['@id'],
      '@type': 'Author',
    });
    expect(result.value.normalizedGraph.entries[0].entity).toEqual(replacement.entries[0].entity);
  });

  test('derives additive types inside nested authored objects', () => {
    const authored = {
      ...authoredEntity,
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'one@example.com',
      },
    };
    const authoredOnly = createGraph([authored]);
    const replacement = createGraph([{
      ...authored,
      contactPoint: {
        ...authored.contactPoint,
        '@type': ['ContactPoint', 'PostalAddress'],
      },
    }]);
    const result = reconcileSemanticEnvelope({
      baseline: {
        html,
        graph: null,
        normalizedGraph: authoredOnly,
        authoredGraph: authoredOnly,
        canonicalUrl,
      },
      value: { html, page, graph: null, normalizedGraph: replacement },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph.entries[0].entity).toEqual({
      '@id': authoredEntity['@id'],
      '@type': 'Person',
      contactPoint: { '@type': 'PostalAddress' },
    });
    expect(result.value.normalizedGraph.entries[0].entity).toEqual(replacement.entries[0].entity);
  });

  test('normalizes relative graph replacements before consistency checks', () => {
    const faq = { '@id': '#faq', '@type': 'FAQPage', url: './faq' };
    const relativeManaged = createGraph([faq]);
    const relativeCombined = createGraph([authoredEntity, faq]);
    const result = reconcileSemanticEnvelope({
      baseline: {
        html,
        graph: null,
        normalizedGraph: authoredGraph,
        authoredGraph,
        canonicalUrl,
      },
      value: {
        html,
        page,
        graph: relativeManaged,
        normalizedGraph: relativeCombined,
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph.entries[0].entity).toMatchObject({
      '@id': `${canonicalUrl}#faq`,
      url: 'https://example.com/faq',
    });
  });

  test('rejects managed scalar conflicts with authored facts', () => {
    const result = reconcileSemanticEnvelope({
      baseline: {
        html,
        graph: null,
        normalizedGraph: authoredGraph,
        authoredGraph,
        canonicalUrl,
      },
      value: {
        html,
        page,
        graph: createGraph([{ ...authoredEntity, name: 'SECRET CONFLICT' }]),
        normalizedGraph: authoredGraph,
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: 'plugin-graph-inconsistent', severity: 'error' }],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  test('sanitizes graph validation failures that contain plugin-controlled pointers', () => {
    const result = reconcileSemanticEnvelope({
      baseline,
      value: {
        html,
        page,
        graph: createGraph([{
          ...managedEntity,
          TOP_SECRET_RELATION: { '@id': '#missing' },
        }]),
        normalizedGraph,
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain('TOP_SECRET_RELATION');
    expect(JSON.stringify(result)).not.toContain('/TOP_SECRET');
  });

  test('supports managed graph removal while retaining authored normalization', () => {
    const result = reconcileSemanticEnvelope({
      baseline,
      value: { html, page, graph: null, normalizedGraph },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.graph).toBeNull();
    expect(result.value.normalizedGraph.entries).toHaveLength(1);
    expect(result.value.normalizedGraph.entries[0].entity).toEqual(authoredEntity);
    expect(result.value.html).toContain(authoredScript);
    expect(result.value.html).not.toContain('data-astro-aeo-graph');
  });

  test.each([
    {
      name: 'reorder',
      items: [
        { '@type': 'ListItem', position: 2, name: 'Second' },
        { '@type': 'ListItem', position: 1, name: 'First' },
      ],
    },
    {
      name: 'middle insertion',
      items: [
        { '@type': 'ListItem', position: 1, name: 'First' },
        { '@type': 'ListItem', position: 2, name: 'Middle' },
        { '@type': 'ListItem', position: 3, name: 'Second' },
      ],
    },
  ])('replays an ordered array $name without changing plugin intent', ({ items }) => {
    const original = {
      '@id': `${canonicalUrl}#list`,
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'First' },
        { '@type': 'ListItem', position: 2, name: 'Second' },
      ],
    };
    const desired = { ...original, itemListElement: items };
    const originalManaged = createGraph([original]);
    const localBaseline = {
      html,
      graph: originalManaged,
      normalizedGraph: createGraph([authoredEntity, original]),
      authoredGraph,
      canonicalUrl,
    };
    const result = reconcileSemanticEnvelope({
      baseline: localBaseline,
      value: {
        html,
        page,
        graph: createGraph([desired]),
        normalizedGraph: localBaseline.normalizedGraph,
      },
      siteUrl,
      strictReferences: true,
      pathname: '/page',
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const replayed = applySemanticGraphPatch(originalManaged, result.changes.managedPatch);
    expect(replayed.valid).toBe(true);
    if (!replayed.valid) return;
    expect(replayed.graph.entries[0].entity.itemListElement).toEqual(items);
  });
});

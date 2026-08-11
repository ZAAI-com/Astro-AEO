import { describe, expect, test } from 'vitest';
import { createGraph } from '../schema.js';
import {
  isExtractionEnvelope,
  isGraphEnvelope,
  isPageDescriptor,
  isPageMetadata,
  isPageRecord,
} from './plugin-validation.js';

function pageRecord() {
  return {
    id: '/',
    pathname: '/',
    rendering: 'prerendered',
    url: 'https://example.test/',
    canonicalUrl: 'https://example.test/',
    markdownUrl: 'https://example.test/index.md',
    metadata: { title: 'Home', description: 'Description', canonicalSource: 'inferred' },
    representations: { html: '<html>\n</html>', markdown: '# Home\n', plainText: 'Home' },
    authors: [],
    entities: [],
    directives: {
      index: true,
      includeInLlms: true,
      includeInLlmsFull: true,
      generateMarkdown: true,
    },
    mdHref: '/index.md',
    title: 'Home',
    description: 'Description',
    markdown: '# Home\n',
    aeoTokens: [],
    source: { kind: 'rendered', strategy: 'rendered' },
    extraction: {
      strategy: 'article',
      selectedNodes: 1,
      removedNodes: 0,
      inputCharacters: 20,
      outputCharacters: 7,
    },
    diagnostics: [],
  };
}

describe('build plugin replacement validation', () => {
  test('accepts complete public page, descriptor, metadata, and extraction shapes', () => {
    const page = pageRecord();
    expect(isPageRecord(page)).toBe(true);
    expect(isPageMetadata(page.metadata)).toBe(true);
    expect(isPageDescriptor({
      pathname: '/guide',
      rendering: 'on-demand',
      markdown: '# Guide\n\nBody',
      source: { kind: 'mdx', body: 'export const x = 1\n# Guide' },
      dates: { published: '2026-08-11T10:00:00.000Z' },
      directives: { index: true },
      authors: [],
      entities: [],
      extraction: page.extraction,
    })).toBe(true);
    expect(isExtractionEnvelope({
      representations: page.representations,
      extraction: page.extraction,
      source: page.source,
    })).toBe(true);
  });

  test('rejects malformed nested page and extraction contracts', () => {
    const page = pageRecord();
    expect(isPageRecord({ ...page, directives: { index: true } })).toBe(false);
    expect(isPageRecord({ ...page, representations: { markdown: 42 } })).toBe(false);
    expect(isPageRecord({ ...page, metadata: { title: 'Home', canonicalSource: 'authored' }, canonicalUrl: undefined })).toBe(false);
    expect(isPageRecord({ ...page, entities: [{ '@type': 'WebPage', url: 'javascript:alert(1)' }] })).toBe(false);
    expect(isExtractionEnvelope({
      representations: page.representations,
      extraction: { strategy: 'article', outputCharacters: 1 },
      source: page.source,
    })).toBe(false);
    expect(isPageDescriptor({ pathname: '/guide/', dates: { published: 'not-a-date' } })).toBe(false);
  });

  test('validates complete graphs while preserving page identity and site facts', () => {
    const page = pageRecord();
    const site = { siteUrl: 'https://example.test', base: '', trailingSlash: 'never' };
    const envelope = {
      html: '<html></html>',
      page,
      site,
      graph: createGraph([{ '@type': 'WebPage', '@id': 'https://example.test/#webpage' }]),
      normalizedGraph: null,
      explicit: false,
    };
    const expected = { id: '/', pathname: '/', site };
    expect(isGraphEnvelope(envelope, expected)).toBe(true);
    expect(isGraphEnvelope({ ...envelope, site: { ...site, base: '/other' } }, expected)).toBe(false);
    expect(isGraphEnvelope({ ...envelope, graph: { version: 1, entries: [{ entity: {} }], conflicts: [] } }, expected)).toBe(false);
  });
});

// @ts-check
import { describe, expect, it } from 'vitest';
import { recommendedAuditDiagnostics } from './build.js';

const WORDS = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');

/** @param {Record<string, unknown>} overrides */
function record(overrides) {
  return /** @type {import('../core/page-model.js').AeoPageRecord} */ (/** @type {unknown} */ ({
    pathname: '/',
    title: 'Home',
    description: 'A description',
    markdown: `# Home\n\n${WORDS}\n`,
    directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    ...overrides,
  }));
}

describe('recommended build diagnostics', () => {
  it('is silent for a healthy page', () => {
    expect(recommendedAuditDiagnostics([record({})])).toEqual([]);
  });

  it('reports page-model rules as versioned diagnostics with a pathname', () => {
    const diagnostics = recommendedAuditDiagnostics([
      record({ pathname: '/a', title: 'Same', markdown: '' }),
      record({ pathname: '/b', title: 'Same', description: '' }),
    ]);
    expect(diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.severity} ${diagnostic.pathname}`).sort()).toEqual([
      'description-missing warning /b',
      'markdown-empty error /a',
      'title-duplicate warning /a',
      'title-duplicate warning /b',
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.version === 1 && diagnostic.message.startsWith('astro-aeo: '))).toBe(true);
  });

  it('skips Markdown rules for a page that opted out of a companion, and link rules always', () => {
    const diagnostics = recommendedAuditDiagnostics([
      record({ markdown: '', directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: false } }),
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('leaves noindex pages out of metadata and duplicate rules', () => {
    const hidden = { index: false, includeInLlms: false, includeInLlmsFull: false, generateMarkdown: true };
    expect(recommendedAuditDiagnostics([
      record({ pathname: '/a', description: '', directives: hidden }),
      record({ pathname: '/b', description: '', directives: hidden }),
    ])).toEqual([]);
  });
});

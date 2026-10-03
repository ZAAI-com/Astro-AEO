import { describe, expect, test } from 'vitest';
import { documentUrlFor, extractPageFacts } from './facts.js';
import { auditPages } from './site-rules.js';

const prose = `# Example\n\n${'ordinary words '.repeat(80)}`;

test('audits known version reciprocity and locale identity without adding audit categories', () => {
  const facts = (url, version) => ({ ...extractPageFacts('<html lang="en"></html>', { url }),
    version, locale: 'en', versionAlternates: [] });
  const current = facts('https://example.test/guide/', 'v2');
  const archived = facts('https://example.test/v1/guide/', 'v1');
  current.versionAlternates.push({ kind: 'version', version: 'v1', url: archived.url });
  expect(auditPages([current, archived]).map((finding) => finding.ruleId)).toContain('version-alternate-not-reciprocal');
  archived.versionAlternates.push({ kind: 'version', version: 'v2', url: current.url });
  expect(auditPages([current, archived]).filter((finding) => finding.ruleId.startsWith('version-'))).toEqual([]);
  archived.locale = 'fr';
  expect(auditPages([current, archived]).map((finding) => finding.ruleId)).toContain('version-alternate-identity-conflict');
});

function rawHtmlFindings(markdown) {
  const page = extractPageFacts('<html lang="en"><head><title>Example</title><meta name="description" content="Example"></head><body></body></html>', {
    url: 'https://example.test/', markdown,
  });
  return auditPages([page]).filter((finding) => finding.ruleId === 'markdown-raw-html');
}

describe('markdown-raw-html', () => {
  test('requires three distinct HTML-containing blocks', () => {
    const largeTable = `<table>${'<tr><td>value</td></tr>'.repeat(20)}</table>`;
    expect(rawHtmlFindings(`${prose}\n\n${largeTable}`)).toHaveLength(0);
    expect(rawHtmlFindings(`${prose}\n\n${largeTable}\n\n${largeTable}`)).toHaveLength(0);
  });

  test('warns once at 30 tags across three blocks', () => {
    const blocks = Array.from({ length: 3 }, () => '<table><tr><td>value</td><td>value</td><td>value</td></tr></table>').join('\n\n');
    expect(rawHtmlFindings(`${prose}\n\n${blocks}`).map((finding) => finding.ruleId)).toEqual(['markdown-raw-html']);
    const shorter = Array.from({ length: 3 }, () => '<table><tr><td>value</td><td>value</td></tr></table>').join('\n\n');
    expect(rawHtmlFindings(`${prose}\n\n${shorter}`)).toHaveLength(0);
  });

  test('warns when markup exceeds a quarter of non-code Markdown', () => {
    const blocks = Array.from({ length: 3 }, () => '<time datetime="2026-09-27">today</time>').join('\n\n');
    expect(rawHtmlFindings(`# Example\n\n${blocks}`)).toHaveLength(1);
    expect(rawHtmlFindings(`${prose}\n\n${blocks}`)).toHaveLength(0);
  });

  test('ignores fenced and inline code', () => {
    const tags = '<table><tr><td>code</td></tr></table>';
    expect(rawHtmlFindings(`${prose}\n\n\`\`\`html\n${tags}\n\n${tags}\n\n${tags}\n\`\`\``)).toHaveLength(0);
    expect(rawHtmlFindings(`${prose}\n\n\`${tags}\`\n\n\`${tags}\`\n\n\`${tags}\``)).toHaveLength(0);
    expect(rawHtmlFindings(`${prose}\n\n<link rel="alternate"\\>\n\n<link rel="alternate"\\>\n\n<link rel="alternate"\\>`)).toHaveLength(0);
  });
});

describe('structured data references', () => {
  /** @param {string[]} scripts */
  function referenceFindings(scripts) {
    const head = scripts.map((script) => `<script type="application/ld+json">${script}</script>`).join('');
    const page = extractPageFacts(`<html lang="en"><head><title>Example</title><meta name="description" content="Example"><link rel="canonical" href="https://example.test/guide/">${head}</head><body></body></html>`, {
      url: 'https://example.test/guide/', markdown: prose,
    });
    return auditPages([page]).filter((finding) => finding.category === 'structured-data');
  }

  test('resolves a reference to a sibling entity of the same @graph', () => {
    expect(referenceFindings([JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', '@id': 'https://example.test/guide/#webpage', breadcrumb: { '@id': 'https://example.test/guide/#breadcrumb' } },
        { '@type': 'BreadcrumbList', '@id': 'https://example.test/guide/#breadcrumb', itemListElement: [] },
      ],
    })])).toEqual([]);
  });

  test('resolves a reference to an entity in another script of the same page', () => {
    expect(referenceFindings([
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', '@id': '#webpage', breadcrumb: { '@id': '#breadcrumb' } }),
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', '@id': '#breadcrumb', itemListElement: [] }),
    ])).toEqual([]);
  });

  test('still warns once for a same-document reference nothing defines', () => {
    const findings = referenceFindings([JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', '@id': '#webpage', breadcrumb: { '@id': '#missing' } },
        { '@type': 'BreadcrumbList', '@id': '#breadcrumb', itemListElement: [] },
      ],
    })]);
    expect(findings.map((finding) => [finding.ruleId, finding.severity])).toEqual([
      ['schema.unresolved-reference', 'warning'],
    ]);
  });
});

describe('documentUrlFor', () => {
  test('keeps a valid page URL when the canonical is non-HTTP or malformed', () => {
    expect(documentUrlFor('https://example.test/a', 'ftp://example.test/a')).toBe('https://example.test/a');
    expect(documentUrlFor('https://example.test/a', 'http://[bad')).toBe('https://example.test/a');
    expect(documentUrlFor('https://example.test/a', '/b')).toBe('https://example.test/b');
    expect(documentUrlFor('/a', 'https://canonical.test/x')).toBe('https://canonical.test/x');
    expect(documentUrlFor('/a', undefined, 'https://site.test')).toBe('https://site.test/a');
    expect(documentUrlFor('/a')).toBeUndefined();
  });
});

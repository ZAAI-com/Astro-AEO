import { describe, expect, test } from 'vitest';
import { extractPageFacts } from './facts.js';
import { auditPages } from './site-rules.js';

const prose = `# Example\n\n${'ordinary words '.repeat(80)}`;

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

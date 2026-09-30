// @ts-check
import { describe, expect, it } from 'vitest';
import { extractPageFacts } from './facts.js';
import { auditEditorial, markdownBlocks } from './editorial.js';
import { auditPages } from './site-rules.js';
import { scoreFindings } from './score.js';

const NOW = new Date('2026-09-30T12:00:00Z');
const prose = 'word '.repeat(151).trim();
const html = (body, head = '', language = 'en-US') => `<html lang="${language}"><head><title>Guide</title><meta name="description" content="Guide">${head}</head><body><main>${body}</main></body></html>`;
const codes = (body, head = '', language = 'en-US', markdown) => auditEditorial(extractPageFacts(html(body, head, language), { url: '/guide', ...(markdown === undefined ? {} : { markdown }) }), NOW).map((finding) => finding.ruleId);

describe('opt-in editorial advice', () => {
  it.each([
    ['editorial-long-paragraph', `<p>${prose}</p>`, '<p>Brief answer.</p>'],
    ['editorial-unanswered-question', '<h2>Why?</h2><h2>Next</h2>', '<h2>Why?</h2><p>An answer.</p>'],
    ['editorial-unsourced-number', '<p>42% of users agree.</p>', '<p>42% agree. <a href="https://example.org/study">Source</a></p>'],
    ['editorial-howto-structure', '<h1>How to publish</h1><p>Publish.</p>', '<h1>How to publish</h1><ol><li>Publish.</li></ol>'],
    ['editorial-comparison-structure', '<h1>Product comparison</h1><p>A and B.</p>', '<h1>Product comparison</h1><table><tr><td>A</td></tr></table>'],
    ['editorial-faq-structure', '<h1>FAQ</h1><p>Overview.</p>', '<h1>FAQ</h1><h2>Why?</h2><p>Because.</p>'],
  ])('%s has a positive case and control', (rule, positive, negative) => {
    expect(codes(positive)).toContain(rule);
    expect(codes(negative)).not.toContain(rule);
  });
  it.each(['en', 'en-GB', 'de', 'de-AT'])('supports article attribution and freshness in %s', (language) => {
    const article = '<article><p>Content.</p></article>';
    const entity = { '@type': 'Article', datePublished: '2020-01-01' };
    const script = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
    expect(codes(article, script(entity), language)).toEqual(['editorial-missing-attribution', 'editorial-review-reminder']);
    expect(codes(article, script({ ...entity, author: { '@type': 'Person', name: 'Ada' }, dateModified: '2026-09-29' }), language)).toEqual([]);
    expect(codes(article, script(entity) + '<meta name="author" content="Ada">', language)).not.toContain('editorial-missing-attribution');
    expect(codes(article + '<a rel="author">Ada</a>', '', language)).not.toContain('editorial-missing-attribution');
  });
  it('resolves named structured authors in sibling graph nodes', () => {
    expect(codes('<article><p>Content.</p></article>', '<script type="application/ld+json">{"@graph":[{"@type":"Article","author":{"@id":"#author"}},{"@type":"Organization","@id":"#author","name":"Team"}]}</script>')).not.toContain('editorial-missing-attribution');
  });
  it('uses UTC days and the latest valid date without calling evergreen content outdated', () => {
    const facts = extractPageFacts(html('<article><p>Content.</p></article>'), { url: '/' });
    facts.editorial.dates = ['invalid', '2025-09-30'];
    expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId)).not.toContain('editorial-review-reminder');
    facts.editorial.dates = ['2025-09-29'];
    const reminder = auditEditorial(facts, NOW).find((finding) => finding.ruleId === 'editorial-review-reminder');
    expect(reminder?.message).toContain('Age alone');
  });
  it.each([
    ['<h1>Wie veröffentliche ich?</h1><p>Antwort.</p>', 'editorial-howto-structure'],
    ['<h1>Produktvergleich: Vergleich A und B</h1>', 'editorial-comparison-structure'],
    ['<h1>Häufig gestellte Fragen</h1>', 'editorial-faq-structure'],
    ['<p>42 Prozent stimmen zu.</p>', 'editorial-unsourced-number'],
  ])('recognizes German phrases', (body, rule) => expect(codes(body, '', 'de-DE')).toContain(rule));
  it.each(['fr-FR', 'ja', ''])('skips phrase-dependent checks in %s', (language) => {
    expect(codes('<h1>How to publish FAQ comparison</h1><p>42 percent agree.</p>', '', language)).toEqual([]);
    expect(codes(`<p>${prose}</p><h2>何故？</h2>`, '', language)).toEqual(['editorial-long-paragraph', 'editorial-unanswered-question']);
  });
  it('skips noindex and unreliable content, and prefers Markdown to rendered prose', () => {
    expect(codes(`<p>${prose}</p>`, '<meta name="robots" content="noindex">')).toEqual([]);
    expect(auditEditorial(extractPageFacts('<body><p>42%</p></body>', { url: '/' }), NOW)).toEqual([]);
    expect(codes(`<p>${prose}</p>`, '', 'en', '# Guide\n\nBrief.')).toEqual([]);
  });
  it.each(['<pre><p>42%</p></pre>', '<blockquote><p>42%</p></blockquote>', '<ul><li><p>42%</p></li></ul>', '<table><tr><td><p>42%</p></td></tr></table>', '<nav><p>42%</p></nav>', '<div hidden><p>42%</p></div>'])('ignores non-prose HTML %s', (body) => expect(codes(body)).not.toContain('editorial-unsourced-number'));
  it('excludes fences, quoted prose, indented code, tables, list continuations and inline code', () => {
    const markdown = `# Guide\n\n\`\`\`js\n${prose} 42%\n\`\`\`\n\n> ${prose} 42%\n\n    42%\n\n| Fact | Value |\n| --- | --- |\n| Long | ${prose} 42% |\n\n- ${prose} 42%\n  continuation\n\nVersion \`42%\`.\n`;
    expect(codes('', '', 'en', markdown)).toEqual([]);
    expect(markdownBlocks(markdown).filter((block) => block.kind === 'paragraph')).toHaveLength(1);
  });
  it('excludes dates and versions and accepts paragraph-local reference citations', () => {
    expect(codes('<p>Example <code>42%</code>.</p>')).toEqual([]);
    expect(codes('', '', 'en', '# Guide\n\nRelease v1.2.3 on 2026-09-30 or 30.09.2026.')).toEqual([]);
    expect(codes('', '', 'en', '# Guide\n\n42% agree [study][ref].\n\n[ref]: https://example.org/study')).toEqual([]);
    expect(codes('', '', 'en', '# Guide\n\n42% agree.\n\n[Study](https://example.org)')).toContain('editorial-unsourced-number');
  });
  it.each(['<ul><li>Answer.</li></ul>', '<table><tr><td>Answer.</td></tr></table>', '<h3>Details</h3><p>Answer.</p>'])('accepts structured answers %s', (answer) => expect(codes(`<h2>Why?</h2>${answer}`)).not.toContain('editorial-unanswered-question'));
  it('preserves scores and default findings, and never includes article passages', () => {
    const facts = extractPageFacts(html(`<p>${prose}</p>`), { url: '/' });
    const baseline = auditPages([facts]);
    const enabled = auditPages([facts], { heuristics: true, now: NOW });
    expect(enabled.filter((finding) => !finding.ruleId.startsWith('editorial-'))).toEqual(baseline);
    expect(scoreFindings(enabled).scores.overall).toBe(scoreFindings(baseline).scores.overall);
    for (const finding of enabled.filter((finding) => finding.ruleId.startsWith('editorial-'))) {
      expect(finding.severity).toBe('info');
      expect(finding.helpUrl).toBeTruthy();
      expect(finding.evidence).toBeUndefined();
      expect(finding.message).not.toContain(prose);
    }
  });
});

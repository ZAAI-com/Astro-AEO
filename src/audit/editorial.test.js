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
  it.each([
    ['#author', 'https://example.com/guide#author'],
    ['https://example.com/guide#author', '#author'],
  ])('normalizes same-page author reference %s to %s', (reference, definition) => {
    const article = { '@type': 'Article', author: { '@id': reference } };
    const author = { '@type': 'Person', '@id': definition, name: 'Ada' };
    const scripts = `<script type="application/ld+json">${JSON.stringify(article)}</script><script type="application/ld+json">${JSON.stringify(author)}</script>`;
    for (const identity of ['canonical', 'live']) {
      const facts = extractPageFacts(html('<article><p>Content.</p></article>',
        scripts + (identity === 'canonical' ? '<link rel="canonical" href="https://example.com/guide">' : '')), {
        url: identity === 'canonical' ? '/guide' : 'https://example.com/guide',
      });
      expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId), identity).not.toContain('editorial-missing-attribution');
    }
  });
  it('does not resolve absent authors or similarly named IDs on another page', () => {
    for (const definition of ['#different-author', 'https://example.com/other#author']) {
      const entities = [{ '@type': 'Article', author: { '@id': '#author' } }, { '@type': 'Person', '@id': definition, name: 'Ada' }];
      const facts = extractPageFacts(html('<article><p>Content.</p></article>', `<script type="application/ld+json">${JSON.stringify(entities)}</script>`), { url: 'https://example.com/guide' });
      expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId)).toContain('editorial-missing-attribution');
    }
  });
  it.each(['forward', 'reverse'])('preserves named authors around reference-only aliases in %s order', (order) => {
    const definitions = [{ '@type': 'Person', '@id': '#author', name: 'Ada' }, { '@id': 'https://example.com/guide#author' }];
    if (order === 'reverse') definitions.reverse();
    const entities = [{ '@type': 'Article', author: { '@id': '#author' } }, ...definitions];
    const facts = extractPageFacts(html('<article><p>Content.</p></article>', `<script type="application/ld+json">${JSON.stringify(entities)}</script>`), { url: 'https://example.com/guide' });
    expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId)).not.toContain('editorial-missing-attribution');
  });
  it.each(['forward', 'reverse'])('combines complementary author definitions in %s order', (order) => {
    const definitions = [{ '@type': 'Person', '@id': '#author' }, { '@id': 'https://example.com/guide#author', name: 'Ada' }];
    if (order === 'reverse') definitions.reverse();
    const entities = [{ '@type': 'Article', author: { '@id': '#author' } }, ...definitions];
    const facts = extractPageFacts(html('<article><p>Content.</p></article>', `<script type="application/ld+json">${JSON.stringify(entities)}</script>`), { url: 'https://example.com/guide' });
    expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId)).not.toContain('editorial-missing-attribution');
    expect(facts.jsonLd).toEqual([JSON.stringify(entities)]);
  });
  it('preserves inline named author metadata when same-ID definitions omit it', () => {
    const entities = [{ '@type': 'Article', author: { '@type': 'Person', '@id': '#author', name: 'Ada' } }, { '@id': 'https://example.com/guide#author', url: 'https://example.com/ada' }];
    const facts = extractPageFacts(html('<article><p>Content.</p></article>', `<script type="application/ld+json">${JSON.stringify(entities)}</script>`), { url: 'https://example.com/guide' });
    expect(auditEditorial(facts, NOW).map((finding) => finding.ruleId)).not.toContain('editorial-missing-attribution');
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
  it.each(['hidden', 'aria-hidden="true"', 'aria-hidden="TRUE"'])('ignores %s descendants in prose and citation links', (attribute) => {
    expect(codes(`<p>Brief. <span ${attribute}>${prose} 42% agree.</span></p>`)).toEqual([]);
    expect(codes(`<p>42% agree. <span ${attribute}><a href="https://example.org/study">Source</a></span></p>`)).toContain('editorial-unsourced-number');
    expect(codes(`<p>42% agree. <span ${attribute}>Not a source.</span><a href="https://example.org/study">Source</a></p>`)).not.toContain('editorial-unsourced-number');
  });
  it('ignores code descendants for both prose and citation detection', () => {
    expect(codes(`<p>Brief. <code>${prose} 42% agree.</code></p>`)).toEqual([]);
    expect(codes('', '', 'en', `# Guide\n\nBrief. <code>${prose} 42% agree.</code>`)).toEqual([]);
    expect(codes('<p>42% agree. <code><a href="https://example.org/study">Source</a></code></p>')).toContain('editorial-unsourced-number');
  });
  it.each(['rel="author"', 'itemprop="author"'])('requires visible %s author content', (attribute) => {
    const article = '<article><p>Content.</p></article>';
    expect(codes(article + `<a ${attribute} hidden>Ada</a>`)).toContain('editorial-missing-attribution');
    expect(codes(article + `<a ${attribute}><span aria-hidden="true">Ada</span></a>`)).toContain('editorial-missing-attribution');
    expect(codes(article + `<header><a ${attribute}><span hidden>Icon</span>Ada</a></header>`)).not.toContain('editorial-missing-attribution');
  });
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
  it.each([
    'mailto:info@example.org', 'tel:+123', 'javascript:alert(1)',
    'data:text/plain,https://example.org/study', ' JAVASCRIPT:alert(1) ',
  ])('rejects non-citation destination %s in HTML and Markdown', (destination) => {
    expect(codes(`<p>42% agree. <a href="${destination}">Source</a></p>`)).toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `# Guide\n\n42% agree. [Source](${destination})`)).toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `# Guide\n\n42% agree. [Source][ref]\n\n[ref]: ${destination}`)).toContain('editorial-unsourced-number');
  });
  it.each(['https://example.org/study', '/study', '../study', '#study', ' https://example.org/study '])('accepts navigable destination %s in HTML and Markdown', (destination) => {
    expect(codes(`<p>42% agree. <a href="${destination}">Source</a></p>`)).not.toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `# Guide\n\n42% agree. [Source](${destination})`)).not.toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `# Guide\n\n42% agree. [Source][ref]\n\n[ref]: ${destination}`)).not.toContain('editorial-unsourced-number');
  });
  it.each([
    ['<img src="https://example.org/chart.png" alt="Chart">', '![Chart](https://example.org/chart.png)'],
    ['<img src="https://example.org/chart.png" alt="Chart">', '![Chart][ref]\n\n[ref]: https://example.org/chart.png'],
    ['<code>https://example.org/study</code>', '`https://example.org/study`'],
    ['<code>https://example.org/study</code>', '<code>https://example.org/study</code>'],
    ['<code>`https://example.org/study`</code>', '`` `https://example.org/study` ``'],
    ['<code>[Source](https://example.org/study)</code>', '`[Source](https://example.org/study)`'],
  ])('does not count image or code citations: %s', (rendered, markdown) => {
    expect(codes(`<p>42% agree. ${rendered}</p>`)).toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `# Guide\n\n42% agree. ${markdown}`)).toContain('editorial-unsourced-number');
  });
  it('accepts actual Markdown autolinks, bare URLs and full, collapsed or shortcut references', () => {
    for (const citation of ['<https://example.org/study>', 'https://example.org/study', '[Source][ref]\n\n[ref]: <https://example.org/study>', '[Source][]\n\n[Source]: https://example.org/study', '[Source]\n\n[Source]: https://example.org/study']) {
      expect(codes('', '', 'en', `# Guide\n\n42% agree. ${citation}`)).not.toContain('editorial-unsourced-number');
    }
    expect(codes('', '', 'en', '# Guide\n\n42% agree. <mailto:info@example.org>')).toContain('editorial-unsourced-number');
  });
  it.each([
    '```text\n[Source]: https://example.org/study\n```',
    '~~~text\n[Source]: https://example.org/study\n~~~',
    '    [Source]: https://example.org/study',
    '<pre>\n[Source]: https://example.org/study\n</pre>',
    '---\nnotes: |\n  [Source]: https://example.org/study\n---',
  ])('ignores reference definitions inside excluded Markdown content: %s', (excluded) => {
    expect(codes('', '', 'en', `${excluded}\n\n# Guide\n\n42% agree. [Source]`)).toContain('editorial-unsourced-number');
    expect(codes('', '', 'en', `${excluded}\n\n# Guide\n\n42% agree. [Real source]\n\n[Real source]: https://example.org/study`)).not.toContain('editorial-unsourced-number');
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

import { test, expect, describe, beforeAll } from 'vitest';
import { parseDocument } from '../html-document.js';
import { assertValidSelectors, cleanRoot, extractMarkdown, selectContentRoots } from './index.js';
import { createTurndown, DEFAULT_EXTRACTION, htmlToMarkdown } from '../html-to-md.js';
import { AeoConfigError } from '../../lib/errors.js';

const doc = (html) => parseDocument(html);
const page = (body) => `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;
let td;
beforeAll(async () => {
  td = await createTurndown();
});

describe('selectContentRoots', () => {
  test('the first selector with a match wins, in order', () => {
    const d = doc(page('<main><article><h1>A</h1></article></main>'));
    expect(selectContentRoots(d, ['article', 'main']).strategy).toBe('article');
    expect(selectContentRoots(d, ['main', 'article']).strategy).toBe('main');
  });

  test('multiple top-level matches are all selected, in document order', () => {
    const d = doc(page('<article><h1>One</h1></article><article><h1>Two</h1></article>'));
    const { roots } = selectContentRoots(d, ['article']);
    expect(roots).toHaveLength(2);
    expect(roots[0].textContent).toContain('One');
    expect(roots[1].textContent).toContain('Two');
  });

  test('a match nested in another match is dropped, so content is not emitted twice', () => {
    const d = doc(page('<article><h1>Outer</h1><article><h2>Inner</h2></article></article>'));
    const { roots } = selectContentRoots(d, ['article']);
    expect(roots).toHaveLength(1);
    expect(roots[0].textContent).toContain('Inner');
  });

  test('falls back to body, recording why', () => {
    const d = doc(page('<div><p>Loose.</p></div>'));
    const result = selectContentRoots(d, ['article', 'main']);
    expect(result.strategy).toBe('body');
    expect(result.fallbackReason).toContain('no element matched');
  });

  test('normalizes fragments into a populated body without losing siblings', () => {
    const result = selectContentRoots(doc('<h2>Fragment</h2>'), ['main']);
    expect(result.strategy).toBe('body');
    expect(result.roots[0].textContent).toContain('Fragment');
  });

  test('never-content elements cannot become extraction roots', () => {
    const d = doc(page('<script>SECRET_SCRIPT</script><iframe>SECRET_FRAME</iframe><main>Safe.</main>'));
    const result = selectContentRoots(d, ['script', 'iframe', 'main']);
    expect(result.strategy).toBe('main');
    expect(result.roots[0].textContent).toBe('Safe.');
  });

  test('does not select content nested inside configured chrome', () => {
    const d = doc(page('<nav><article>Navigation teaser</article></nav><main>Actual content</main>'));
    const result = selectContentRoots(d, ['article', 'main'], ['nav', 'footer']);
    expect(result.strategy).toBe('main');
    expect(result.roots[0].textContent).toBe('Actual content');
  });

  test('does not restore fallback content inside a removed document ancestor', () => {
    const d = doc(page('<main>Must stay removed</main>'));
    const { markdown } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, selectors: ['article'], removeSelectors: ['html'] },
      td,
    );
    expect(markdown).toBe('');
  });
});

describe('cleanRoot', () => {
  test('removes the never-content tags and the configured chrome', () => {
    const d = doc(page('<main><nav>skip</nav><p>keep</p><script>evil()</script><footer>skip</footer></main>'));
    const root = d.querySelector('main');
    const removed = cleanRoot(root, { removeSelectors: ['nav', 'footer'], keepSelectors: [] });
    expect(removed).toBe(3);
    expect(root.textContent).toContain('keep');
    expect(root.textContent).not.toContain('skip');
    expect(root.textContent).not.toContain('evil');
  });

  test('removal beats keepSelectors, and the unsafe tags can never be restored', () => {
    const d = doc(page('<main><aside class="x">drop</aside><script class="x">evil()</script></main>'));
    const root = d.querySelector('main');
    cleanRoot(root, { removeSelectors: ['aside'], keepSelectors: ['.x'] });
    expect(root.innerHTML).toBe('');
  });

  test('removeSelectors can remove the selected root itself', () => {
    const d = doc(page('<article class="drop-root"><p>secret</p></article>'));
    const { markdown, diagnostics } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, selectors: ['.drop-root'], removeSelectors: ['.drop-root'] },
      td,
    );
    expect(markdown).toBe('');
    expect(diagnostics.removedNodes).toBe(1);
  });
});

describe('extractMarkdown', () => {
  test('reports which selector won and how much was dropped', () => {
    const d = doc(page('<main><nav>chrome</nav><h1>Title</h1><p>Body.</p></main>'));
    const { markdown, diagnostics } = extractMarkdown(d, DEFAULT_EXTRACTION, td);
    expect(markdown).toBe('# Title\n\nBody.');
    expect(diagnostics.strategy).toBe('main');
    expect(diagnostics.selectedNodes).toBe(1);
    expect(diagnostics.removedNodes).toBe(1);
    expect(diagnostics.outputCharacters).toBe(markdown.length);
    expect(diagnostics.inputCharacters).toBeGreaterThan(diagnostics.outputCharacters);
    expect(diagnostics.fallbackReason).toBeUndefined();
  });

  test('keepSelectors preserves an element as raw HTML', () => {
    const d = doc(page('<main><p>Before.</p><div class="widget"><b>raw</b></div></main>'));
    const { markdown } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, keepSelectors: ['.widget'] },
      td,
    );
    expect(markdown).toContain('<div class="widget"><b>raw</b></div>');
    expect(markdown).toContain('Before.');
    // The marker attribute must not survive into the output.
    expect(markdown).not.toContain('data-astro-aeo-keep');
  });

  test('keepSelectors preserves the selected root itself as raw HTML', () => {
    const d = doc(page('<article class="root-widget"><b>raw root</b></article>'));
    const { markdown } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, selectors: ['.root-widget'], keepSelectors: ['.root-widget'] },
      td,
    );
    expect(markdown).toBe('<article class="root-widget"><b>raw root</b></article>');
    expect(markdown).not.toContain('data-astro-aeo-keep');
  });

  test('separate roots are joined with a blank line', () => {
    const d = doc(page('<article><p>One.</p></article><article><p>Two.</p></article>'));
    expect(extractMarkdown(d, DEFAULT_EXTRACTION, td).markdown).toBe('One.\n\nTwo.');
  });

  test('forbidden configured roots never leak their contents through fallback', () => {
    const d = doc(page('<script>SECRET_SCRIPT</script><iframe>SECRET_FRAME</iframe><p>Safe body.</p>'));
    const { markdown } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, selectors: ['script', 'iframe'] },
      td,
    );
    expect(markdown).toContain('Safe body.');
    expect(markdown).not.toMatch(/SECRET_SCRIPT|SECRET_FRAME/);
  });

  test('preserves every top-level fragment node', () => {
    const { markdown } = extractMarkdown(doc('<h1>Hello</h1><p>Body</p>'), DEFAULT_EXTRACTION, td);
    expect(markdown).toBe('# Hello\n\nBody');
  });

  test('normalizes a doctype-prefixed fragment without corrupting its siblings', () => {
    const { markdown } = extractMarkdown(
      doc('<!DOCTYPE html><meta charset="utf-8"><h1>Fragment title</h1><p>Body</p>'),
      DEFAULT_EXTRACTION,
      td,
    );
    expect(markdown).toBe('# Fragment title\n\nBody');
  });

  test('normalizes a doctype after leading comments without corrupting siblings', () => {
    const { markdown } = extractMarkdown(
      doc('<!-- lead --><!DOCTYPE html><meta charset="utf-8"><h1>Fragment title</h1><p>Body</p>'),
      DEFAULT_EXTRACTION,
      td,
    );
    expect(markdown).toBe('# Fragment title\n\nBody');
  });

  test('normalizes processing instructions and quoted doctype identifiers', () => {
    const processingInstruction = extractMarkdown(
      doc('<?xml version="1.0"?><!doctype html><main>B</main><p>C</p>'),
      { ...DEFAULT_EXTRACTION, selectors: ['body'] },
      td,
    );
    const quotedIdentifier = extractMarkdown(
      doc('<!DOCTYPE html PUBLIC "foo>bar"><h1>A</h1><p>B</p>'),
      DEFAULT_EXTRACTION,
      td,
    );

    expect(processingInstruction.markdown).toBe('B\n\nC');
    expect(quotedIdentifier.markdown).toBe('# A\n\nB');
  });

  test('keeps fragment content that begins with a closing body tag', () => {
    const { markdown } = extractMarkdown(
      doc('</body><p>After</p>'),
      DEFAULT_EXTRACTION,
      td,
    );
    expect(markdown).toBe('After');
  });

  test('treats embedded html-like text as fragment content', () => {
    const { markdown } = extractMarkdown(
      doc('<p>Before &lt;html&gt;</p><p>After</p>'),
      DEFAULT_EXTRACTION,
      td,
    );
    expect(markdown).toContain('Before');
    expect(markdown).toContain('After');
  });

  test('returns empty Markdown for empty, text-only, and comment-only documents', () => {
    expect(extractMarkdown(doc(''), DEFAULT_EXTRACTION, td).markdown).toBe('');
    expect(extractMarkdown(doc('<!-- comment -->'), DEFAULT_EXTRACTION, td).markdown).toBe('');
    expect(extractMarkdown(doc('Just text'), DEFAULT_EXTRACTION, td).markdown).toBe('Just text');
  });
});

describe('resolveUrls', () => {
  const BASE = 'https://x.com/blog/post/';
  const extract = (body, baseUrl = BASE) =>
    extractMarkdown(doc(page(body)), DEFAULT_EXTRACTION, td, { baseUrl });

  test('root-relative and document-relative links become absolute', () => {
    // A .md companion is read away from the site that served it, so a relative
    // href is a dead link the moment the file is copied somewhere else.
    const md = extract('<main><a href="/about/">A</a> <a href="../other/">B</a></main>').markdown;
    expect(md).toContain('(https://x.com/about/)');
    expect(md).toContain('(https://x.com/blog/other/)');
  });

  test('image sources are resolved too', () => {
    const md = extract('<main><img src="/logo.png" alt="Logo"></main>').markdown;
    expect(md).toContain('(https://x.com/logo.png)');
  });

  test('URLs inside preserved semantic HTML are resolved', () => {
    const md = extract(
      '<main><figure><img src="/chart.png" alt="Chart"><figcaption><a href="/data">Data</a></figcaption></figure></main>',
    ).markdown;
    expect(md).toContain('src="https://x.com/chart.png"');
    expect(md).toContain('href="https://x.com/data"');
  });

  test('absolute URLs are left untouched', () => {
    const md = extract('<main><a href="https://other.dev/x">X</a></main>').markdown;
    expect(md).toContain('(https://other.dev/x)');
  });

  test('fragments and non-navigational schemes are left exactly as authored', () => {
    const md = extract(
      '<main><a href="#top">Top</a> <a href="mailto:a@b.c">Mail</a> <a href="tel:+15550100">Call</a></main>',
    ).markdown;
    expect(md).toContain('(#top)');
    expect(md).toContain('(mailto:a@b.c)');
    expect(md).toContain('(tel:+15550100)');
  });

  test('an unparseable href is left alone rather than guessed at', () => {
    const md = extract('<main><a href="http://[bad">X</a></main>').markdown;
    expect(md).toContain('http://[bad');
  });

  test('nothing is rewritten when no base URL is known', () => {
    const md = extractMarkdown(
      doc(page('<main><a href="/about/">A</a></main>')),
      DEFAULT_EXTRACTION,
      td,
    ).markdown;
    expect(md).toContain('(/about/)');
  });

  test('rewrites a selected link root itself', () => {
    const { markdown } = extractMarkdown(
      doc(page('<a class="root" href="/about">About</a>')),
      { ...DEFAULT_EXTRACTION, selectors: ['.root'] },
      td,
      { baseUrl: BASE },
    );
    expect(markdown).toBe('[About](https://x.com/about)');
  });
});

describe('conversion fidelity', () => {
  const convert = (body) =>
    extractMarkdown(doc(page(body)), DEFAULT_EXTRACTION, td).markdown;

  test('a code language class survives as a fence info string', () => {
    const md = convert('<main><pre><code class="language-js">const a = 1;</code></pre></main>');
    expect(md).toContain('```js');
    expect(md).toContain('const a = 1;');
  });

  test('whitespace around the content root does not leak into the output', () => {
    expect(convert('<main>   <h1>T</h1>  <p>B.</p>   </main>')).toBe('# T\n\nB.');
  });

  test('tables convert without dropping their cells', () => {
    const md = convert('<main><table><caption>Totals</caption><tr><th>A</th></tr><tr><td colspan="2">1</td></tr></table></main>');
    expect(md).toContain('<table>');
    expect(md).toContain('<caption>Totals</caption>');
    expect(md).toContain('colspan="2"');
    expect(md).not.toContain('data-astro-aeo-keep');
  });

  test('definition lists and figures retain their authored structure', () => {
    const md = convert(
      '<main><dl><dt>Term</dt><dd>Definition</dd></dl><figure><img src="/chart.png" alt="Chart"><figcaption>Quarterly results</figcaption></figure></main>',
    );
    expect(md).toContain('<dl>');
    expect(md).toContain('<dt>Term</dt>');
    expect(md).toContain('<figure>');
    expect(md).toContain('<figcaption>Quarterly results</figcaption>');
  });

  test('time, address, and citations stay semantic HTML', () => {
    const md = convert(
      '<main><p>Published <time datetime="2026-08-05">today</time>.</p><address>Berlin</address><p><cite>Primary source</cite></p></main>',
    );
    expect(md).toContain('<time datetime="2026-08-05">today</time>');
    expect(md).toContain('<address>Berlin</address>');
    expect(md).toContain('<cite>Primary source</cite>');
  });

  test('raw semantic HTML drops active attributes and unsafe protocols', () => {
    const md = convert(
      '<main><figure onclick="steal()" style="background:url(javascript:steal())"><a href="java&#10;script:steal()" ping="https://tracker.test">Unsafe</a><img src="data:image/svg+xml,unsafe" onerror="steal()" srcset="unsafe 2x"><object data="javascript:steal()">Object</object><figcaption aria-label="Safe caption">Caption</figcaption></figure></main>',
    );
    expect(md).toContain('<figure>');
    expect(md).toContain('aria-label="Safe caption"');
    expect(md).not.toMatch(/onclick|onerror|style=|javascript:|data:image|srcset|ping=|object data=/i);
  });

  test('raw semantic HTML drops active metadata and resource elements', () => {
    const md = convert(
      '<main><figure><meta http-equiv="refresh" content="0;url=javascript:evil"><base href="https://evil.test/"><link rel="stylesheet" href="javascript:evil"><figcaption>Safe</figcaption></figure></main>',
    );
    expect(md).toContain('<figure>');
    expect(md).toContain('<figcaption>Safe</figcaption>');
    expect(md).not.toMatch(/<meta|<base|<link|javascript:/i);
  });

  test('empty links and images inherit accessible labels', () => {
    const md = convert(
      '<main><span id="account-label">Account</span><a href="/account" aria-labelledby="account-label"></a><a href="/help" aria-label="Help"></a><img src="/search.svg" aria-label="Search"></main>',
    );
    expect(md).toContain('[Account](/account)');
    expect(md).toContain('[Help](/help)');
    expect(md).toContain('![Search](/search.svg)');
  });

  test('enriches a selected image root with its accessible label', () => {
    const { markdown } = extractMarkdown(
      doc(page('<img class="root" src="/search.svg" aria-label="Search">')),
      { ...DEFAULT_EXTRACTION, selectors: ['.root'] },
      td,
    );
    expect(markdown).toBe('![Search](/search.svg)');
  });
});

describe('regressions the regex extractor could not handle', () => {
  // The previous implementation sliced <main> out of the source text with a
  // non-greedy regex, so it stopped at the first </main> wherever it appeared.
  test('a closing tag inside a comment no longer truncates the page', async () => {
    const md = await htmlToMarkdown(page('<main><h1>Real</h1><!-- </main> --><p>Kept.</p></main>'));
    expect(md).toContain('Kept.');
  });

  test('a closing tag inside a script string no longer truncates the page', async () => {
    const md = await htmlToMarkdown(page('<main><h1>Real</h1><script>var s = "</main>";</script><p>Kept.</p></main>'));
    expect(md).toContain('Kept.');
    expect(md).not.toContain('var s');
  });

  test('a document with no main no longer feeds <head> to the converter', async () => {
    const md = await htmlToMarkdown(page('<div><p>Body.</p></div>'));
    expect(md).toContain('Body.');
    expect(md).not.toContain('T');
  });
});

describe('assertValidSelectors', () => {
  const probe = doc('<html></html>');

  test('accepts real selectors', () => {
    expect(() => assertValidSelectors(probe, 'markdown.extraction.selectors', ['main', 'article.post > h1'])).not.toThrow();
  });

  test('rejects an invalid selector as a configuration error', () => {
    expect(() => assertValidSelectors(probe, 'markdown.extraction.selectors', ['main['])).toThrow(AeoConfigError);
    expect(() => assertValidSelectors(probe, 'markdown.extraction.selectors', ['main['])).toThrow(/invalid CSS selector/);
  });

  test('rejects an empty selector, which would silently match nothing', () => {
    expect(() => assertValidSelectors(probe, 'markdown.extraction.removeSelectors', ['  '])).toThrow(AeoConfigError);
  });
});

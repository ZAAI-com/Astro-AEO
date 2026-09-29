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
    const d = doc(page('<main><p>Before.</p><div class="widget" data-shot="x"><b class="bold">raw</b></div></main>'));
    const { markdown } = extractMarkdown(
      d,
      { ...DEFAULT_EXTRACTION, keepSelectors: ['.widget'] },
      td,
    );
    expect(markdown).toContain('<b>raw</b>');
    expect(markdown).not.toMatch(/class=|data-shot|<div/);
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
    expect(markdown).toBe('<article><b>raw root</b></article>');
    expect(markdown).not.toContain('data-astro-aeo-keep');
  });

  test('keepSelectors minimizes a selected div root and retains semantic attributes', () => {
    const { markdown, diagnostics } = extractMarkdown(
      doc(page('<div class="selected" data-shot="x"><a href="/guide" class="link">Guide</a></div>')),
      { ...DEFAULT_EXTRACTION, selectors: ['.selected'], keepSelectors: ['.selected'] }, td,
    );
    expect(markdown).toBe('<a href="/guide">Guide</a>');
    expect(diagnostics.keptHtmlBlocks).toBe(1);
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

  test('URLs inside figures and raw tables are resolved', () => {
    const md = extract(
      '<main><figure><img src="/chart.png" alt="Chart"><figcaption><a href="/data">Data</a></figcaption></figure><table><tr><td colspan="2"><a href="/cell">Cell</a></td></tr></table></main>',
    ).markdown;
    expect(md).toContain('![Chart](https://x.com/chart.png)');
    expect(md).toContain('[Data](https://x.com/data)');
    expect(md).toContain('href="https://x.com/cell"');
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

  test('conversion preserves the source tree and cross-root accessible labels', () => {
    const d = doc(page('<article><span id="label">Account  &amp; settings</span></article>' +
      '<article><a href="/account" aria-labelledby="label"></a>' +
      '<pre><code>&lt;tag&gt; &amp;amp;  two spaces\nnext</code></pre></article>'));
    const roots = [...d.querySelectorAll('article')];
    const { markdown } = extractMarkdown(d, DEFAULT_EXTRACTION, td);
    expect(markdown).toBe('Account & settings\n\n[Account & settings](/account)\n\n' +
      '```\n<tag> &amp;  two spaces\nnext\n```');
    expect([...d.querySelectorAll('article')]).toEqual(roots);
    expect(d.getElementById('label').textContent).toBe('Account  & settings');
    expect(d.querySelector('code').textContent).toBe('<tag> &amp;  two spaces\nnext');
  });

  test('a code language class survives as a fence info string', () => {
    const md = convert('<main><pre><code class="language-js">const a = 1;</code></pre></main>');
    expect(md).toContain('```js');
    expect(md).toContain('const a = 1;');
  });

  describe('code fence languages', () => {
    test.each([
      ['Shiki data-language', '<pre class="astro-code" data-language="bash"><code><span class="line"><span>npm</span><span> i</span></span></code></pre>', '```bash\nnpm i\n```'],
      ['plaintext data-language', '<pre data-language="plaintext"><code>a \u2192 b</code></pre>', '```\na \u2192 b\n```'],
      ['uppercase data-language', '<pre data-language="JavaScript"><code>x</code></pre>', '```javascript\nx\n```'],
      ['code data-language', '<pre><code data-language="ts">x</code></pre>', '```ts\nx\n```'],
      ['code lang-*', '<pre><code class="lang-js">x</code></pre>', '```js\nx\n```'],
      ['pre language-*', '<pre class="language-js"><code>x</code></pre>', '```js\nx\n```'],
      ['explicit class wins over data-language', '<pre data-language="bash"><code class="language-text">x</code></pre>', '```text\nx\n```'],
      ['newline after pre', '<pre data-language="bash">\n<code>npm install</code></pre>', '```bash\nnpm install\n```'],
      ['caption filename', '<figure><figcaption>index.html (what most bots see)</figcaption><pre><code>&lt;p&gt;</code></pre></figure>', '_index.html (what most bots see)_\n\n```html\n<p>\n```'],
      ['caption prose', '<figure><figcaption>Running the server with Node.js</figcaption><pre><code>npm start</code></pre></figure>', '_Running the server with Node.js_\n\n```\nnpm start\n```'],
      ['pre without code is unchanged', '<pre data-language="bash">npm install</pre>', 'npm install'],
    ])('%s', (_name, body, expected) => {
      expect(convert(`<main>${body}</main>`)).toBe(expected);
    });

    test('Expressive Code lines join with newlines', () => {
      const md = convert('<main><figure class="frame"><figcaption><span class="sr-only">Terminal window</span></figcaption>' +
        '<pre data-language="sh"><code><div class="ec-line"><div class="code"><span>::</span><span>:note</span></div></div>' +
        '<div class="ec-line"><div class="code"><span>two</span></div></div></code></pre></figure></main>');
      expect(md).toContain('```sh\n:::note\ntwo\n```');
    });

    test('kept raw HTML stays byte-stable', () => {
      const html = '<main><div class="keep"><pre data-language="bash">\n<code>x</code></pre></div></main>';
      const md = extractMarkdown(doc(page(html)), { ...DEFAULT_EXTRACTION, keepSelectors: ['.keep'] }, td).markdown;
      expect(md).toContain('<pre>\n<code>x</code></pre>');
      expect(md).not.toContain('```');
    });
  });

  test('whitespace around the content root does not leak into the output', () => {
    expect(convert('<main>   <h1>T</h1>  <p>B.</p>   </main>')).toBe('# T\n\nB.');
  });

  test('simple tables become GFM pipe tables', () => {
    const md = convert(
      '<main><table class="grid"><caption>Totals</caption><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td><div class="cell"><b>A</b></div></td><td>1 | 2</td></tr><tr><td>B</td></tr></tbody></table></main>',
    );
    expect(md).toBe('_Totals_\n\n| Name | Value |\n| --- | --- |\n| **A** | 1 \\| 2 |\n| B |  |');
  });

  test('complex tables stay HTML without presentational attributes', () => {
    const md = convert(
      '<main><table class="min-w-full" data-astro-cid-x=""><caption>Totals</caption><tr><th scope="col" class="px-4">A</th></tr><tr><td colspan="2"><div class="p-2"><span>1</span></div></td></tr></table></main>',
    );
    expect(md).toContain('<table><caption>Totals</caption>');
    expect(md).toContain('<th scope="col">A</th>');
    expect(md).toContain('<td colspan="2">1</td>');
    expect(md).not.toMatch(/class=|data-astro|<div|<span/);
  });

  test('tables with block content in a cell stay HTML', () => {
    const md = convert('<main><table><tr><td><p>One</p><p>Two</p></td></tr></table></main>');
    expect(md).toContain('<table>');
    expect(md).toContain('<p>One</p>');
  });

  test('figures become an image and an emphasized caption', () => {
    const md = convert(
      '<main><figure class="rounded shadow" data-shot="x"><div class="wrap"><img src="/chart.png" alt="Chart"></div><figcaption>Quarterly <b>results</b></figcaption></figure></main>',
    );
    expect(md).toBe('![Chart](/chart.png)\n\n_Quarterly **results**_');
  });

  test('light and dark screenshots emit only the light variant', () => {
    const md = convert('<main><figure><img class="dark:hidden" src="/light.png" alt="Dashboard"><img class="hidden dark:block" src="/dark.png" alt="Dashboard dark mode"><figcaption>Dashboard</figcaption></figure></main>');
    expect(md).toBe('![Dashboard](/light.png)\n\n_Dashboard_');
    const wrapped = convert('<main><figure><div class="dark:hidden"><img src="/light.png" alt="Dashboard"></div><div class="hidden dark:block"><img src="/dark.png" alt="Dashboard dark mode"></div></figure></main>');
    expect(wrapped).toBe('![Dashboard](/light.png)');
  });

  test('a dark: utility on a shared wrapper does not collapse distinct images', () => {
    const md = convert('<main><figure><div class="overflow-hidden border dark:border-zinc-800"><img src="/a.png" alt="Before"><img src="/b.png" alt="After"></div></figure></main>');
    expect(md).toBe('![Before](/a.png) ![After](/b.png)');
  });

  test('a hidden dark:block pair keeps one image', () => {
    const md = convert('<main><figure><img class="block dark:hidden" src="/l.png" alt="Light"><img class="hidden dark:!block" src="/d.png" alt="Dark"></figure></main>');
    expect(md).toBe('![Light](/l.png)');
  });

  test('a dark-first pair yields the light image', () => {
    const md = convert('<main><figure><img class="hidden dark:block" src="/d.png" alt="Dark"><img class="dark:hidden" src="/l.png" alt="Light"></figure></main>');
    expect(md).toBe('![Light](/l.png)');
  });

  test('a Starlight sl-hidden pair keeps the light image', () => {
    const md = convert('<main><figure><img class="light:sl-hidden" src="/d.png" alt="Dark"><img class="dark:sl-hidden" src="/l.png" alt="Light"></figure></main>');
    expect(md).toBe('![Light](/l.png)');
  });

  test('aria-hidden alternates are dropped only while a shown image remains', () => {
    const md = convert('<main><figure><img src="/a.png" alt="Dots"><img aria-hidden="true" src="/b.png" alt="Smart"><img aria-hidden="true" src="/c.png" alt="Standard"></figure></main>');
    expect(md).toBe('![Dots](/a.png)');
    const all = convert('<main><figure><div aria-hidden="true"><img src="/a.png" alt="A"><img src="/b.png" alt="B"></div></figure></main>');
    expect(all).toContain('![A](/a.png)');
    expect(all).toContain('![B](/b.png)');
  });

  test('an image followed by inline labels is separated by spaces', () => {
    const md = convert('<main><figure><div><img src="/a.png" alt="A"><span>One</span><span>Two</span></div></figure></main>');
    expect(md).toBe('![A](/a.png) One Two');
  });

  test('images inside an inline wrapper get no leading indentation', () => {
    const shots = [0, 1, 2, 3, 4].map((i) => `<img src="/g${i}.png" alt="Shot ${i}">`).join('');
    const md = convert(`<main><p>Intro.</p><astro-island><figure>${shots}<figcaption>Gallery</figcaption></figure></astro-island></main>`);
    expect(md).toBe(`Intro.\n\n${[0, 1, 2, 3, 4].map((i) => `![Shot ${i}](/g${i}.png)`).join(' ')}\n\n_Gallery_`);
  });

  test('code token spans inside a figure are not spaced', () => {
    const md = convert('<main><figure data-rehype-pretty-code-figure><img src="/a.png" alt="A"><pre><code><span data-line><span>console</span><span>.log(</span><span>"a"</span><span>)</span></span></code></pre></figure></main>');
    expect(md).toContain('console.log("a")');
  });

  test('figcaption punctuation spans are not spaced', () => {
    const md = convert('<main><figure><img src="/a.png" alt="A"><figcaption><a href="/src">Source</a><span>.</span> Price <span>$</span><span>5</span></figcaption></figure></main>');
    expect(md).toBe('![A](/a.png)\n\n_[Source](/src). Price $5_');
  });

  test('image-free charts retain their label when they have no readable text', () => {
    const md = convert('<main><figure><div role="region" aria-label="Solar production by day"><svg><path/></svg></div></figure></main>');
    expect(md).toBe('Solar production by day');
  });

  test('image-free chart labels do not concatenate adjacent legend items', () => {
    const md = convert('<main><figure><div><span>Under 20 kWh</span><span>20 to 40 kWh</span></div><figcaption>Daily solar</figcaption></figure></main>');
    expect(md).toBe('Under 20 kWh 20 to 40 kWh\n\n_Daily solar_');
  });

  test('definition lists become bold terms with their descriptions', () => {
    const md = convert(
      '<main><dl class="grid"><div class="card"><dt class="t">Term</dt><dd class="d">Definition <a href="/x">link</a>.</dd></div><dt>Other</dt><dd><p>One.</p><p>Two.</p></dd></dl></main>',
    );
    expect(md).toBe('**Term**\n\nDefinition [link](/x).\n\n**Other**\n\nOne.\n\nTwo.');
  });

  describe('definition terms with block markup stay one bold run', () => {
    test.each([
      ['an icon wrapper whose svg is dropped',
        '<dt class="font-semibold"> <div class="absolute flex size-10 bg-accent"> ' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" class="size-6"> <path d="M3 12h3l3-9 4 18 3-9h5"></path> </svg> ' +
        '</div> Track Data Leaks </dt><dd>Instantly know.</dd>',
        '**Track Data Leaks**\n\nInstantly know.'],
      ['a heading', '<dt><h3>Title</h3></dt><dd>d</dd>', '**Title**\n\nd'],
      ['a header block before the label', '<dt><header><span>Kicker</span></header>Label</dt><dd>d</dd>',
        '**Kicker Label**\n\nd'],
      ['an icon image', '<dt><div><img src="/i.png" alt="Icon"></div>Label</dt><dd>d</dd>',
        '**![Icon](/i.png) Label**\n\nd'],
      ['a term that is already bold', '<dt><strong>Term</strong></dt><dd>d</dd>', '**Term**\n\nd'],
      ['a partly bold term', '<dt><b>Term</b> extra</dt><dd>d</dd>', '**Term extra**\n\nd'],
    ])('%s', (_name, body, expected) => {
      expect(convert(`<main><dl>${body}</dl></main>`)).toBe(expected);
    });
  });

  test('time, address, and citations convert to their text', () => {
    const md = convert(
      '<main><p>Published <time datetime="2026-08-05">today</time>.</p><address>Berlin</address><p><cite>Primary source</cite></p></main>',
    );
    expect(md).toBe('Published today.\n\nBerlin\n\nPrimary source');
  });

  test('interface chrome is dropped before conversion', () => {
    const md = convert(
      '<main><p>Path<button>Copy</button><span aria-hidden="true">Copied</span></p><svg><text>icon</text></svg><template><p>Inert</p></template><p hidden>Hidden</p><div aria-hidden="true"><img src="/shot.png" alt="Screenshot"></div></main>',
    );
    expect(md).toBe('Path\n\n![Screenshot](/shot.png)');
  });

  describe('aria-hidden glyphs', () => {
    const hidden = (glyph, extra = '') => `<span${extra} aria-hidden="true">${glyph}</span>`;
    const folder = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14"></path></svg>';
    const treeRow = (prefix, name) =>
      `<li class="flex"> ${hidden(prefix, ' class="whitespace-pre"')} ${folder} <span class="truncate"> ${name}\n</span> </li>`;

    test('an arrow between two values in one row is kept', () => {
      const md = convert(
        '<main><ul role="list"><li class="flex flex-wrap"> <span class="font-medium">github.com</span> ' +
        `${hidden('→', ' class="text-gray-400"')} <span class="font-mono">github.com@yourdomain.com</span> ` +
        '<span class="ml-auto"> Catch-All </span> </li></ul></main>',
      );
      expect(md).toBe('-   github.com → github.com@yourdomain.com Catch-All');
    });

    test('separators between spans are kept and spaced', () => {
      const md = convert(
        `<main><div class="flex"> <span>1 user</span> ${hidden('·')} <span>2 orgs</span> ${hidden('·')} ` +
        '<span>7 repos</span> </div>' +
        `<p class="mt-8">\nOpen source${hidden('·', ' class="mx-2"')}Privacy-first\n</p></main>`,
      );
      expect(md).toBe('1 user · 2 orgs · 7 repos\n\nOpen source · Privacy-first');
    });

    test('a colon separator attaches to its label', () => {
      const md = convert(`<main><p><span>Status</span>${hidden(':')}<span>Stable</span></p></main>`);
      expect(md).toBe('Status: Stable');
    });

    test('a separator padded with no-break spaces is kept', () => {
      const md = convert(`<main><p><span>Before</span>${hidden('\u00a0\u2014\u00a0')}<span>After</span></p></main>`);
      expect(md).toBe('Before \u2014 After');
    });

    test('tree prefixes keep their depth, across the icon before the name', () => {
      const md = convert(
        '<main><ul>' +
        treeRow('├── ', 'manuelgruber/') +
        treeRow('│   ├── ', '.github/') +
        treeRow('│   │   │   └── ', 'deep/') +
        treeRow('    └── ', 'example.ai/') +
        '</ul></main>',
      );
      const nbsp = (/** @type {number} */ n) => '\u00a0'.repeat(n);
      expect(md).toBe(
        `-   ├── manuelgruber/\n-   │${nbsp(3)}├── .github/\n` +
        `-   │${nbsp(3)}│${nbsp(3)}│${nbsp(3)}└── deep/\n-   ${nbsp(4)}└── example.ai/`,
      );
    });

    test('unwrapped glyphs are not counted as removed nodes', () => {
      const { diagnostics } = extractMarkdown(
        doc(page(`<main><p><span>a</span> ${hidden('·')} <span>b</span> ${hidden('·')}</p></main>`)),
        DEFAULT_EXTRACTION,
        td,
      );
      expect(diagnostics.removedNodes).toBe(1);
    });

    test.each([
      ['a link arrow', `<p><a href="/docs">Read the docs ${hidden('→')}</a></p>`, '[Read the docs](/docs)'],
      ['a separator list item in a breadcrumb',
        '<ol><li><a href="/">Home</a></li><li aria-hidden="true">/</li><li><a href="/docs">Docs</a></li></ol>',
        '1.  [Home](/)\n2.  [Docs](/docs)'],
      ['a separator followed only by a Copy button',
        `<p>Note ${hidden('→')}<button>Copy</button></p>`, 'Note'],
      ['a Copied label', `<p>Run it <span aria-hidden="true">Copied</span></p>`, 'Run it'],
      ['a heading anchor', '<h2>Title <a href="#title" aria-hidden="true">#</a></h2>', '## Title'],
      ['shell prompts in a code block',
        `<pre><code>${hidden('$ ')}npm i\n${hidden('$ ')}npm test</code></pre>`, '```\nnpm i\nnpm test\n```'],
      ['an emoji check mark with a variation selector',
        `<p>Done ${hidden('✔️')} ok</p>`, 'Done ok'],
      ['a glyph at the end of a block', `<p><span>Trailing</span> ${hidden('|')}</p><p>Next</p>`, 'Trailing\n\nNext'],
      ['an arrow between two links',
        `<div><a href="/a">GitHub</a>${hidden('→')}<a href="/b">npm</a>${hidden('→')}</div>`,
        '[GitHub](/a)[npm](/b)'],
      ['a box-drawing divider with nothing after it',
        `<p>A</p><div>${hidden('────────')}</div><p>B</p>`, 'A\n\nB'],
    ])('%s is dropped', (_name, body, expected) => {
      expect(convert(`<main>${body}</main>`)).toBe(expected);
    });
  });

  test('disclosure toggles keep their label', () => {
    const md = convert(
      '<main><button aria-expanded="false" aria-controls="a">Does it work?</button><div id="a">Yes.</div></main>',
    );
    expect(md).toContain('Does it work?');
    expect(md).toContain('Yes.');
  });

  test('raw HTML drops active attributes and unsafe protocols', () => {
    const md = convert(
      '<main><table onclick="steal()" style="background:url(javascript:steal())"><tr><td rowspan="2"><a href="java&#10;script:steal()" ping="https://tracker.test">Unsafe</a><img src="data:image/svg+xml,unsafe" onerror="steal()" srcset="unsafe 2x"><object data="javascript:steal()">Object</object><span aria-label="Safe label">Label</span></td></tr></table></main>',
    );
    expect(md).toContain('<table>');
    expect(md).toContain('aria-label="Safe label"');
    expect(md).not.toMatch(/onclick|onerror|style=|javascript:|data:image|srcset|ping=|object data=/i);
  });

  test('raw HTML drops active metadata and resource elements', () => {
    const md = convert(
      '<main><table><tr><td colspan="2"><meta http-equiv="refresh" content="0;url=javascript:evil"><base href="https://evil.test/"><link rel="stylesheet" href="javascript:evil">Safe</td></tr></table></main>',
    );
    expect(md).toContain('<td colspan="2">Safe</td>');
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

import { beforeAll, describe, expect, test } from 'vitest';
import { parseDocument } from '../html-document.js';
import { createTurndown, DEFAULT_EXTRACTION } from '../html-to-md.js';
import { extractMarkdown } from './index.js';

let td;
beforeAll(async () => { td = await createTurndown(); });

const convert = (body, options = {}) => extractMarkdown(
  parseDocument(`<!doctype html><html><body>${body}</body></html>`),
  { ...DEFAULT_EXTRACTION, ...options }, td,
).markdown;

const group = (attributes = 'hidden', content = '<p>Install with pnpm.</p>') => `
  <div role="tablist">
    <button role="tab" id="npm-tab" aria-controls="npm-panel" aria-selected="true">npm</button>
    <button role="tab" id="pnpm-tab" aria-controls="pnpm-panel" aria-selected="false">pnpm</button>
  </div>
  <div role="tabpanel" id="npm-panel" aria-labelledby="npm-tab"><p>Install with npm.</p></div>
  <div role="tabpanel" id="pnpm-panel" aria-labelledby="pnpm-tab" ${attributes}>${content}</div>`;

describe('rendered ARIA tabs', () => {
  test.each(['hidden', 'aria-hidden="true"', 'hidden aria-hidden="true"', 'style="display: none"'])(
    'keeps inactive panel content with %s and labels each panel once', (attributes) => {
      expect(convert(`<main>${group(attributes)}</main>`)).toBe(
        '**npm**\n\nInstall with npm.\n\n**pnpm**\n\nInstall with pnpm.',
      );
    },
  );

  test('recognizes Starlight anchor tabs without aria-controls', () => {
    const body = '<main><starlight-tabs><div class="tablist-wrapper not-content"><ul role="tablist">' +
      '<li role="presentation"><a role="tab" id="tab-0-0" href="#tab-panel-0-0">npm</a></li>' +
      '<li role="presentation"><a role="tab" id="tab-0-1" href="#tab-panel-0-1">pnpm</a></li></ul></div>' +
      '<div role="tabpanel" id="tab-panel-0-0" aria-labelledby="tab-0-0"><pre><code>npm i</code></pre></div>' +
      '<div role="tabpanel" id="tab-panel-0-1" aria-labelledby="tab-0-1" hidden><pre><code>pnpm i</code></pre></div>' +
      '</starlight-tabs></main>';
    expect(convert(body)).toBe('**npm**\n\n```\nnpm i\n```\n\n**pnpm**\n\n```\npnpm i\n```');
  });

  test('uses aria-controls when a panel omits aria-labelledby', () => {
    expect(convert(`<main>${group().replaceAll(/ aria-labelledby="[^"]+"/g, '')}</main>`))
      .toContain('**pnpm**\n\nInstall with pnpm.');
  });

  test('ignores an empty aria-label in favor of the rendered tab text', () => {
    expect(convert(`<main>${group().replace('id="pnpm-tab"', 'id="pnpm-tab" aria-label="   "')}</main>`))
      .toContain('**pnpm**\n\nInstall with pnpm.');
  });

  test('keeps panel document order even if controls are in another order', () => {
    const body = '<main><div role="tablist"><button role="tab" aria-controls="b">B</button>' +
      '<button role="tab" aria-controls="a">A</button></div>' +
      '<div role="tabpanel" id="a" hidden><p>First.</p></div>' +
      '<div role="tabpanel" id="b"><p>Second.</p></div></main>';
    expect(convert(body)).toBe('**A**\n\nFirst.\n\n**B**\n\nSecond.');
  });

  test('keeps nested inactive widgets and does not repeat their controls', () => {
    const inner = '<div role="tablist"><button role="tab" id="os-tab" aria-controls="os-panel">Linux</button></div>' +
      '<div role="tabpanel" id="os-panel" aria-labelledby="os-tab" hidden><p>Linux command.</p></div>';
    expect(convert(`<main>${group('hidden', `<p>Package manager.</p>${inner}`)}</main>`)).toBe(
      '**npm**\n\nInstall with npm.\n\n**pnpm**\n\nPackage manager.\n\n**Linux**\n\nLinux command.',
    );
  });

  test('preserves a selected panel root and resolves its label outside the selected root', () => {
    expect(convert(group(), { selectors: ['#pnpm-panel'] })).toBe('**pnpm**\n\nInstall with pnpm.');
  });

  test('removes unrelated hidden descendants and surrounding chrome', () => {
    const content = '<p>Visible command.</p><p hidden>SECRET_CHILD</p>' +
      '<span aria-hidden="true">SECRET_STATUS</span><button>Copy</button>';
    const body = `<main><aside hidden>SECRET_ASIDE</aside>${group('hidden', content)}</main>`;
    const markdown = convert(body);
    expect(markdown).toContain('**pnpm**\n\nVisible command.');
    expect(markdown).not.toMatch(/SECRET|Copy/);
  });

  test('does not reveal a widget inside an unrelated hidden ancestor', () => {
    expect(convert(`<main><p>Visible.</p><div hidden>${group()}</div></main>`)).toBe('Visible.');
  });

  test.each([
    '<div role="tabpanel" hidden>SECRET_PANEL</div>',
    '<span id="label">Not a tab</span><div role="tabpanel" aria-labelledby="label" hidden>SECRET_PANEL</div>',
    '<button role="tab" id="label">No tablist</button><div role="tabpanel" aria-labelledby="label" hidden>SECRET_PANEL</div>',
    '<div role="tablist"><button role="tab" id="label" aria-controls="other">Wrong panel</button></div>' +
      '<div role="tabpanel" id="panel" aria-labelledby="label" hidden>SECRET_PANEL</div>',
    '<div role="tablist"><button role="tab" id="label">One</button><button role="tab" id="label">Two</button></div>' +
      '<div role="tabpanel" aria-labelledby="label" hidden>SECRET_PANEL</div>',
    '<div role="tablist"><button role="tab" aria-controls="panel">One</button><button role="tab" aria-controls="panel">Two</button></div>' +
      '<div role="tabpanel" id="panel" hidden>SECRET_PANEL</div>',
    '<div role="tablist"><button role="tab" aria-controls="panel">One</button></div>' +
      '<div id="panel"></div><div role="tabpanel" id="panel" hidden>SECRET_PANEL</div>',
  ])('does not preserve ambiguous or unrecognized hidden panels (%#)', (body) => {
    expect(convert(`<main>${body}</main>`)).not.toContain('SECRET_PANEL');
  });

  test('does not associate an outer control with a nested panel', () => {
    const body = '<main><div role="tablist"><button role="tab" id="tab">Outer</button></div>' +
      '<div role="tabpanel" aria-labelledby="tab"><p>Outer body.</p>' +
      '<div role="tabpanel" aria-labelledby="tab" hidden>SECRET_NESTED</div></div></main>';
    expect(convert(body)).toBe('**Outer**\n\nOuter body.');
  });

  test.each(['#pnpm-panel', '[hidden]', '.tabs'])('explicit removal of %s wins over preservation', (selector) => {
    const markdown = convert(`<main><div class="tabs">${group()}</div></main>`, {
      removeSelectors: [selector],
    });
    expect(markdown).not.toContain('Install with pnpm.');
  });

  test('does not use an explicitly removed tab label', () => {
    const markdown = convert(`<main>${group()}</main>`, { removeSelectors: ['#pnpm-tab'] });
    expect(markdown).not.toContain('pnpm');
  });

  test('removes unsafe label markup and escapes literal HTML and Markdown', () => {
    const body = '<main><div role="tablist"><button role="tab" id="label">' +
      '<svg><title>SECRET_ICON</title></svg><script>SECRET_SCRIPT</script><span hidden>SECRET_HIDDEN</span>' +
      '<b>&lt;img src=x onerror=alert(1)&gt; [click](javascript:alert(1)) &amp;lt;</b>' +
      '</button></div><div role="tabpanel" aria-labelledby="label" hidden><p>Safe content.</p></div></main>';
    const markdown = convert(body);
    expect(markdown).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markdown).toContain('\\[click\\](javascript:alert(1)) &amp;lt;');
    expect(markdown).not.toMatch(/SECRET|<img|<script/);
  });

  test('honors aria-label and removed label descendants without executing scripts', () => {
    const body = '<main><div role="tablist"><button role="tab" id="label" aria-label="Safe &lt;b&gt;label&lt;/b&gt;">' +
      '<span class="omit">SECRET_LABEL</span><svg></svg></button></div>' +
      '<div role="tabpanel" aria-labelledby="label" hidden><p>Content.</p>' +
      '<script>globalThis.__aeoTabScript = true</script></div></main>';
    expect(convert(body, { removeSelectors: ['.omit'] })).toBe('**Safe &lt;b&gt;label&lt;/b&gt;**\n\nContent.');
    expect(globalThis.__aeoTabScript).toBeUndefined();
  });

  test('removes configured label descendants before taking their text', () => {
    const body = '<main><div role="tablist"><button role="tab" id="label">Safe<span class="omit">SECRET</span></button></div>' +
      '<div role="tabpanel" aria-labelledby="label" hidden><p>Content.</p></div></main>';
    expect(convert(body, { selectors: ['[role="tabpanel"]'], removeSelectors: ['.omit'] }))
      .toBe('**Safe**\n\nContent.');
  });

  test('kept raw HTML panels remain sanitized without exposing internal label markers', () => {
    const markdown = convert(`<main>${group('hidden onclick="evil()"')}</main>`, {
      keepSelectors: ['#pnpm-panel'],
    });
    expect(markdown).toContain('<p><strong>pnpm</strong></p><p>Install with pnpm.</p>');
    expect(markdown).not.toMatch(/data-astro-aeo|onclick|hidden/);
  });
});

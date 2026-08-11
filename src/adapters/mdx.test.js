import { describe, expect, test } from 'vitest';
import renderer from './mdx.js';

const render = (body, options) => renderer.render({
  pathname: '/guide',
  html: '<html><body><main><h1>Rendered fallback</h1></main></body></html>',
  canonicalUrl: 'https://example.test/guide',
  rendering: 'prerendered',
  extraction: { selectors: ['main'], removeSelectors: [], keepSelectors: [] },
  source: { kind: 'mdx', body },
  ...(options === undefined ? {} : { options }),
});

describe('astro-aeo/mdx', () => {
  test('declines non-MDX sources and accepts empty authored MDX', () => {
    expect(renderer.render({ source: { kind: 'markdown', body: '# Markdown' } }))
      .toEqual({ status: 'decline' });
    expect(render('')).toEqual({ status: 'rendered', markdown: '' });
  });

  test('parses but never evaluates ESM', () => {
    delete globalThis.__astroAeoMdxExecuted;
    const result = render(
      'export const value = (() => { globalThis.__astroAeoMdxExecuted = true })()\n\n# Safe source',
    );
    expect(result).toEqual({ status: 'rendered', markdown: '\n\n# Safe source' });
    expect(globalThis.__astroAeoMdxExecuted).toBeUndefined();
  });

  test.each([
    ['unwrap', { action: 'unwrap' }, '\n\n**Important**\n\n'],
    ['omit', { action: 'omit' }, ''],
    ['element', { action: 'element', name: 'aside' }, '<aside>\n\n**Important**\n\n</aside>'],
  ])('applies the JSON-only %s component mapping', (_name, mapping, expected) => {
    const result = render('<Callout>\n\n**Important**\n\n</Callout>', {
      components: { Callout: mapping },
    });
    expect(result).toEqual({ status: 'rendered', markdown: expected });
  });

  test('removes an omitted component without interpreting nested JSX', () => {
    const result = render('Before\n\n<Secret><Unknown>{run()}</Unknown></Secret>\n\nAfter', {
      components: { Secret: { action: 'omit' } },
    });
    expect(result).toEqual({ status: 'rendered', markdown: 'Before\n\n\n\nAfter' });
  });

  test.each([
    ['an unmapped semantic component', '<Callout>Important</Callout>'],
    ['a JavaScript expression', '# {globalThis.sideEffect = true}'],
    ['an expression attribute', '<Callout value={run()}>Important</Callout>'],
  ])('requests rendered-HTML fallback for %s', (_label, body) => {
    expect(render(body)).toMatchObject({
      status: 'fallback-to-html',
      diagnostics: [{ code: 'mdx-rendered-html-fallback', severity: 'warning' }],
    });
  });

  test('rejects unsafe or non-JSON component mappings', () => {
    expect(render('<Callout />', {
      components: { Callout: { action: 'element', name: 'script' } },
    })).toMatchObject({
      status: 'continue',
      diagnostics: [{ code: 'mdx-invalid-component-mapping' }],
    });
  });
});

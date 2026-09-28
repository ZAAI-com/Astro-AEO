// @ts-check
import { describe, expect, it } from 'vitest';
import { starlightMarkdown } from './markdown.js';

/** @param {string} source @param {boolean} [mdx] */
const convert = (source, mdx = false) => starlightMarkdown(source, { mdx });

describe('Starlight Markdown conversion', () => {
  it('leaves ordinary Markdown alone and normalizes line endings', () => {
    expect(convert('Intro\r\n\r\n## Heading\r\n\r\n- item\r\n')).toEqual({ markdown: 'Intro\n\n## Heading\n\n- item\n' });
  });

  it('turns every aside type into a labeled blockquote, with and without a title', () => {
    expect(convert(':::note\nplain\n:::\n\n:::danger[Data loss]\nbold **text**\n\nsecond\n:::')).toEqual({
      markdown: '> **Note**\n>\n> plain\n\n> **Danger: Data loss**\n>\n> bold **text**\n>\n> second\n',
    });
  });

  it('nests asides', () => {
    expect(convert(':::tip\nouter\n:::caution\ninner\n:::\nafter\n:::')).toEqual({
      markdown: '> **Tip**\n>\n> outer\n> > **Caution**\n> >\n> > inner\n\n> after\n',
    });
  });

  it('never reads a directive, a component or a brace inside a code fence', () => {
    const source = '```jsx\n:::note\n<Tabs>{value}</Tabs>\n:::\n```\n\n~~~~\n```\n:::tip\n~~~~\n';
    expect(convert(source, true)).toEqual({ markdown: source });
  });

  it('keeps a fence inside an aside quoted', () => {
    expect(convert(':::note\n```sh\nls\n```\n:::')).toEqual({ markdown: '> **Note**\n>\n> ```sh\n> ls\n> ```\n' });
  });

  it('labels tabs, cards and the Aside component, and drops MDX imports', () => {
    const source = [
      "import { Tabs, TabItem, Aside, Card, LinkCard } from '@astrojs/starlight/components';",
      '',
      '<Tabs syncKey="pm">',
      '  <TabItem label="npm">',
      'npm i',
      '  </TabItem>',
      "  <TabItem label='pnpm'>",
      'pnpm add',
      '  </TabItem>',
      '</Tabs>',
      '<Aside type="caution" title="Careful">',
      'Back up.',
      '</Aside>',
      '<Card title="Next steps">',
      'Read on.',
      '</Card>',
      '<LinkCard title="Guide" href="/guide/" />',
    ].join('\n');
    expect(convert(source, true)).toEqual({
      markdown: '**npm**\nnpm i\n\n**pnpm**\npnpm add\n\n> **Caution: Careful**\n>\n> Back up.\n\n**Next steps**\nRead on.\n\n**[Guide](/guide/)**\n',
    });
  });

  it.each([
    ['an unknown component', '<Chart data="x" />'],
    ['an expression', 'Total: {items.length}'],
    ['an exported value', 'export const year = 2026;\n\nText'],
    ['a multi-line import', "import {\n  Tabs,\n} from 'x';\n\nText"],
    ['a label computed at run time', '<TabItem label={name}>'],
    ['a card without a literal title', '<Card icon="star">'],
    ['an aside left open', '<Aside>\nnever closed'],
  ])('falls back for %s', (_label, source) => {
    expect(convert(source, true)).toEqual({ fallback: 'dynamic-mdx' });
  });

  it('allows braces and tags in inline code, and escaped braces', () => {
    expect(convert('Use `<Tabs>` and `{x}` and \\{literal}.', true)).toEqual({ markdown: 'Use `<Tabs>` and `{x}` and \\{literal}.\n' });
  });

  it('treats braces and capitalized tags as text in plain Markdown', () => {
    expect(convert('A {brace} and <Thing> stay.')).toEqual({ markdown: 'A {brace} and <Thing> stay.\n' });
  });

  it('falls back when a fence or an aside never closes', () => {
    expect(convert('```js\nunclosed')).toEqual({ fallback: 'dynamic-mdx' });
    expect(convert(':::note\nunclosed')).toEqual({ fallback: 'dynamic-mdx' });
  });
});

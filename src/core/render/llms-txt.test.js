import { test, expect, describe } from 'vitest';
import { renderLlmsTxt, renderLlmsFullTxt, selectFullTxtPages } from './llms-txt.js';
import { resolveConfig } from '../../config.js';

/** @param {Partial<any>} over */
const page = (over) => ({
  pathname: '/',
  url: 'https://x.com/',
  mdHref: '/index.md',
  title: 'Home',
  description: '',
  markdown: 'Body.',
  aeoTokens: [],
  lastModified: undefined,
  ...over,
});

const SITE = { name: 'Site', description: 'A site.' };

const pages = [
  page({}),
  page({ pathname: '/blog/a', url: 'https://x.com/blog/a/', mdHref: '/blog/a.md', title: 'Post A', description: 'First.', lastModified: '2026-02-15T00:00:00.000Z' }),
  page({ pathname: '/about', url: 'https://x.com/about/', mdHref: '/about.md', title: 'About' }),
];

const SECTIONED = resolveConfig({
  corpus: {
    index: {
      sections: [
        { title: 'Home', match: '/' },
        { title: 'Blog', match: '/blog/**' },
      ],
      defaultSection: 'Pages',
    },
  },
});

describe('renderLlmsTxt', () => {
  test('groups by section rule, then the default section', () => {
    const out = renderLlmsTxt(pages, SECTIONED, SITE);
    expect(out).toContain('# Site');
    expect(out).toContain('> A site.');
    expect(out.indexOf('## Home')).toBeLessThan(out.indexOf('## Blog'));
    expect(out.indexOf('## Blog')).toBeLessThan(out.indexOf('## Pages'));
    expect(out).toContain('- [Post A](/blog/a.md): First.');
  });

  test('showLastModified appends the date, and is off by default', () => {
    expect(renderLlmsTxt(pages, SECTIONED, SITE)).not.toContain('_(updated');
    const withDates = resolveConfig({
      corpus: { index: { showLastModified: true, sections: SECTIONED.corpus.index.sections } },
    });
    expect(renderLlmsTxt(pages, withDates, SITE)).toContain('_(updated 2026-02-15)_');
  });

  test('includeDescriptions: false drops the trailing description', () => {
    const cfg = resolveConfig({ corpus: { index: { includeDescriptions: false } } });
    expect(renderLlmsTxt(pages, cfg, SITE)).not.toContain(': First.');
  });

  test('a no-dotmd page is omitted by default and linked to HTML when included', () => {
    const noMd = [page({ pathname: '/x', url: 'https://x.com/x/', mdHref: '/x.md', title: 'X', aeoTokens: ['no-dotmd'] })];
    expect(renderLlmsTxt(noMd, resolveConfig(), SITE)).not.toContain('X');
    const included = resolveConfig({ corpus: { index: { includeHtmlOnly: true } } });
    expect(renderLlmsTxt(noMd, included, SITE)).toContain('- [X](https://x.com/x/)');
  });

  test('honors equivalent normalized directive hints', () => {
    const hidden = page({
      pathname: '/hidden',
      title: 'Hidden',
      directives: { includeInLlms: false, includeInLlmsFull: true, generateMarkdown: true },
    });
    const htmlOnly = page({
      pathname: '/html-only',
      url: 'https://x.com/html-only/',
      title: 'HTML only',
      directives: { includeInLlms: true, includeInLlmsFull: true, generateMarkdown: false },
    });
    expect(renderLlmsTxt([hidden, htmlOnly], resolveConfig(), SITE)).not.toContain('Hidden');
    expect(renderLlmsTxt([hidden, htmlOnly], resolveConfig(), SITE)).not.toContain('HTML only');
    const included = resolveConfig({ corpus: { index: { includeHtmlOnly: true } } });
    expect(renderLlmsTxt([htmlOnly], included, SITE)).toContain(
      '- [HTML only](https://x.com/html-only/)',
    );
  });

  test('the dev banner is inserted only when passed', () => {
    expect(renderLlmsTxt(pages, SECTIONED, SITE)).not.toContain('dev preview');
    expect(renderLlmsTxt(pages, SECTIONED, SITE, { note: '<!-- dev preview -->' })).toContain('dev preview');
  });

  test('an empty site description omits the blockquote entirely', () => {
    expect(renderLlmsTxt(pages, SECTIONED, { name: 'Site', description: '' })).not.toContain('>');
  });

  test('a runtime rule whose function match was omitted falls through safely', () => {
    const config = resolveConfig({ corpus: { index: { defaultSection: 'Fallback' } } });
    config.corpus.index.sections = [{ title: 'Build only', match: undefined }];
    expect(renderLlmsTxt(pages, config, SITE)).toContain('## Fallback');
  });
});

describe('selectFullTxtPages', () => {
  test("'all' keeps every eligible page", () => {
    expect(selectFullTxtPages(pages, resolveConfig())).toHaveLength(3);
  });

  test("'index' keeps only the home page", () => {
    const cfg = resolveConfig({ corpus: { full: { mode: 'index' } } });
    expect(selectFullTxtPages(pages, cfg).map((p) => p.pathname)).toEqual(['/']);
  });

  test("'first-page-only' keeps one page in build order", () => {
    const cfg = resolveConfig({ corpus: { full: { mode: 'first-page-only' } } });
    expect(selectFullTxtPages(pages, cfg)).toHaveLength(1);
  });

  test('no-llms and no-llms-full are dropped in every mode', () => {
    const opted = [
      page({ pathname: '/a', aeoTokens: ['no-llms'] }),
      page({ pathname: '/b', aeoTokens: ['no-llms-full'] }),
    ];
    expect(selectFullTxtPages(opted, resolveConfig())).toEqual([]);
  });

  test('normalized corpus directives exclude full-corpus pages', () => {
    const opted = [page({
      pathname: '/a',
      directives: { includeInLlms: true, includeInLlmsFull: false, generateMarkdown: true },
    })];
    expect(selectFullTxtPages(opted, resolveConfig())).toEqual([]);
  });

  test('a no-dotmd page still appears, since it has content to inline', () => {
    const opted = [page({ pathname: '/a', aeoTokens: ['no-dotmd'] })];
    expect(selectFullTxtPages(opted, resolveConfig())).toHaveLength(1);
  });
});

describe('renderLlmsFullTxt', () => {
  test('emits a separator-delimited record per page', () => {
    const out = renderLlmsFullTxt(pages, resolveConfig(), SITE);
    expect(out).toContain('# Post A');
    expect(out).toContain('URL: https://x.com/blog/a/');
    expect(out).toContain('Description: First.');
    expect(out.match(/^---$/gm)).toHaveLength(4); // one header separator plus one per page
  });

  test('honours the mode, which the dev server used to ignore', () => {
    const cfg = resolveConfig({ corpus: { full: { mode: 'index' } } });
    const out = renderLlmsFullTxt(pages, cfg, SITE);
    expect(out).toContain('# Home');
    expect(out).not.toContain('# Post A');
  });
});

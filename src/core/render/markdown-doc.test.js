import { test, expect, describe } from 'vitest';
import { renderMarkdownDocument, isoDate } from './markdown-doc.js';
import { resolveConfig } from '../../config.js';

const page = {
  title: 'About',
  url: 'https://x.com/about/',
  description: 'An about page.',
  markdown: '# About\n\nBody.',
  lastModified: new Date('2026-02-15T00:00:00Z'),
};

describe('renderMarkdownDocument', () => {
  test('bare body when frontmatter is off, with a last-modified footer', () => {
    const out = renderMarkdownDocument(page, resolveConfig());
    expect(out).toBe('# About\n\nBody.\n\n_Last modified: 2026-02-15_\n');
  });

  test('frontmatter carries title, url, description and lastModified', () => {
    const out = renderMarkdownDocument(page, resolveConfig({ markdown: { frontmatter: true } }));
    expect(out).toBe(
      '---\ntitle: "About"\nurl: https://x.com/about/\ndescription: "An about page."\nlastModified: 2026-02-15\n---\n\n# About\n\nBody.\n',
    );
  });

  test('the footer is suppressed when frontmatter already states the date', () => {
    const out = renderMarkdownDocument(page, resolveConfig({ markdown: { frontmatter: true } }));
    expect(out).not.toContain('_Last modified:');
  });

  test('includeLastModified: false drops the date from both places', () => {
    const bare = renderMarkdownDocument(page, resolveConfig({ markdown: { includeLastModified: false } }));
    expect(bare).not.toContain('Last modified');
    const withFm = renderMarkdownDocument(
      page,
      resolveConfig({ markdown: { includeLastModified: false, frontmatter: true } }),
    );
    expect(withFm).not.toContain('lastModified');
  });

  test('a page with no date renders neither the field nor the footer', () => {
    const undated = { ...page, lastModified: undefined };
    expect(renderMarkdownDocument(undated, resolveConfig())).toBe('# About\n\nBody.\n');
    expect(
      renderMarkdownDocument(undated, resolveConfig({ markdown: { frontmatter: true } })),
    ).not.toContain('lastModified');
  });

  test('an empty description is omitted rather than emitted empty', () => {
    const out = renderMarkdownDocument(
      { ...page, description: '' },
      resolveConfig({ markdown: { frontmatter: true } }),
    );
    expect(out).not.toContain('description:');
  });

  test('titles and descriptions are JSON-quoted, so a quote cannot break the YAML', () => {
    const out = renderMarkdownDocument(
      { ...page, title: 'He said "hi"', description: 'a: b' },
      resolveConfig({ markdown: { frontmatter: true } }),
    );
    expect(out).toContain('title: "He said \\"hi\\""');
    expect(out).toContain('description: "a: b"');
  });
});

test('isoDate takes the date part only', () => {
  expect(isoDate(new Date('2026-02-15T23:59:59Z'))).toBe('2026-02-15');
});

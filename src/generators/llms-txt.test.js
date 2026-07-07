import { test, expect, describe } from 'vitest';
import { sectionFor, groupSections, isLlmsEligible, llmsEntryHref } from './llms-txt.js';
import { resolveConfig } from '../config.js';

/** @param {string} pathname @param {Partial<any>} [extra] */
function page(pathname, extra = {}) {
  const mdHref = pathname === '/' ? '/index.md' : `${pathname}.md`;
  return { pathname, url: `https://x${pathname}`, mdHref, title: pathname, description: '', markdown: '', aeoTokens: new Set(), ...extra };
}

describe('sectionFor', () => {
  const sections = [
    { title: 'Home', match: '/' },
    { title: 'Blog', match: '/blog/**' },
    { title: 'Posts', match: /^\/\d{4}\/[^/]+$/ },
  ];

  test('first match wins in rule order', () => {
    expect(sectionFor(page('/'), sections, 'Pages')).toBe('Home');
    expect(sectionFor(page('/blog/x'), sections, 'Pages')).toBe('Blog');
    expect(sectionFor(page('/2026/x'), sections, 'Pages')).toBe('Posts');
  });

  test('falls back to defaultSection', () => {
    expect(sectionFor(page('/about'), sections, 'Pages')).toBe('Pages');
  });

  test('defaultSection false drops the page', () => {
    expect(sectionFor(page('/about'), sections, false)).toBe(null);
  });

  test('predicate matcher', () => {
    const rules = [{ title: 'Products', match: (p) => /^\/[a-z0-9-]+$/.test(p.pathname) && p.pathname !== '/about' }];
    expect(sectionFor(page('/c5h'), rules, 'Pages')).toBe('Products');
    expect(sectionFor(page('/about'), rules, 'Pages')).toBe('Pages');
  });
});

describe('groupSections', () => {
  const sections = [
    { title: 'Home', match: '/' },
    { title: 'Blog', match: '/blog/**' },
  ];

  test('emits in rule order and drops empty sections', () => {
    const groups = groupSections([page('/'), page('/blog/a'), page('/blog/b')], sections, 'Pages');
    expect(groups.map((g) => g.title)).toEqual(['Home', 'Blog']);
    expect(groups[1].pages.length).toBe(2);
  });

  test('default section appears last when populated', () => {
    const groups = groupSections([page('/'), page('/about'), page('/contact')], sections, 'Pages');
    expect(groups.map((g) => g.title)).toEqual(['Home', 'Pages']);
    expect(groups[1].pages.map((p) => p.pathname)).toEqual(['/about', '/contact']);
  });

  test('preserves page order within a section', () => {
    const groups = groupSections([page('/blog/z'), page('/blog/a')], sections, 'Pages');
    expect(groups[0].pages.map((p) => p.pathname)).toEqual(['/blog/z', '/blog/a']);
  });
});

describe('isLlmsEligible / llmsEntryHref', () => {
  const base = resolveConfig({});
  const withNoDotmd = resolveConfig({ llmsTxt: { includeNoDotmd: true } });

  test('no-llms pages are never eligible', () => {
    expect(isLlmsEligible(page('/x', { aeoTokens: new Set(['no-llms']) }), base)).toBe(false);
  });

  test('no-dotmd pages are dropped by default', () => {
    expect(isLlmsEligible(page('/x', { aeoTokens: new Set(['no-dotmd']) }), base)).toBe(false);
  });

  test('no-dotmd pages are kept and link to HTML when includeNoDotmd is on', () => {
    const p = page('/x', { aeoTokens: new Set(['no-dotmd']) });
    expect(isLlmsEligible(p, withNoDotmd)).toBe(true);
    expect(llmsEntryHref(p, withNoDotmd)).toBe(p.url);
  });

  test('normal pages are eligible and link to their .md companion', () => {
    const p = page('/x');
    expect(isLlmsEligible(p, base)).toBe(true);
    expect(llmsEntryHref(p, base)).toBe(p.mdHref);
  });
});

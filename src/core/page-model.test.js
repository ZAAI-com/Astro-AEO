import { test, expect, describe } from 'vitest';
import {
  absoluteUrl,
  basePrefix,
  buildPage,
  mdHrefFor,
  mdPathnameFor,
  pagePathForMdPath,
  urlPath,
} from './page-model.js';
import { resolveConfig } from '../config.js';

const site = { siteUrl: 'https://x.com', base: '', trailingSlash: 'always' };
const page = (body, head = '') =>
  `<!doctype html><html><head><title>T</title>${head}</head><body><main>${body}</main></body></html>`;

describe('URL helpers', () => {
  test('urlPath honours trailingSlash, and root is always "/"', () => {
    expect(urlPath('/', 'always')).toBe('/');
    expect(urlPath('/', 'never')).toBe('/');
    expect(urlPath('/a', 'always')).toBe('/a/');
    expect(urlPath('/a', 'ignore')).toBe('/a/');
    expect(urlPath('/a', 'never')).toBe('/a');
  });

  test('basePrefix treats "" and "/" alike and trims a trailing slash', () => {
    expect(basePrefix('')).toBe('');
    expect(basePrefix('/')).toBe('');
    expect(basePrefix('/docs')).toBe('/docs');
    expect(basePrefix('/docs/')).toBe('/docs');
  });

  test('absoluteUrl composes origin, base and path', () => {
    expect(absoluteUrl('https://x.com', '/docs', '/a', 'always')).toBe('https://x.com/docs/a/');
    expect(absoluteUrl('https://x.com', '', '/', 'never')).toBe('https://x.com/');
  });

  test('mdPathnameFor and pagePathForMdPath are inverses', () => {
    for (const pathname of ['/', '/a', '/blog/post']) {
      expect(pagePathForMdPath(mdPathnameFor(pathname))).toBe(pathname);
    }
  });

  test('pagePathForMdPath rejects anything that is not a companion', () => {
    expect(pagePathForMdPath('/about')).toBeNull();
    expect(pagePathForMdPath('/about.html')).toBeNull();
    expect(pagePathForMdPath('/readme.markdown')).toBeNull();
  });

  test('mdHrefFor is base-prefixed', () => {
    expect(mdHrefFor('/a', '/docs')).toBe('/docs/a.md');
    expect(mdHrefFor('/', '')).toBe('/index.md');
  });
});

describe('buildPage', () => {
  const config = resolveConfig();

  test('produces a normalized record from rendered HTML', () => {
    const result = buildPage({
      pathname: '/about/',
      html: page('<h1>About</h1><p>Body.</p>', '<meta name="description" content="Desc.">'),
      config,
      site,
    });
    expect('page' in result).toBe(true);
    const { page: p } = result;
    expect(p.pathname).toBe('/about');
    expect(p.url).toBe('https://x.com/about/');
    expect(p.mdHref).toBe('/about.md');
    expect(p.title).toBe('T');
    expect(p.description).toBe('Desc.');
    expect(p.markdown).toBe('# About\n\nBody.');
    expect(p.extraction?.strategy).toBe('main');
  });

  test('every skip is reported with a reason rather than silently dropped', () => {
    const excluded = buildPage({
      pathname: '/private/x',
      html: page('<p>x</p>'),
      config: resolveConfig({ pages: { exclude: ['/private/**'] } }),
      site,
    });
    expect(excluded).toEqual({ skip: 'excluded' });

    const redirect = buildPage({
      pathname: '/old',
      html: page('<p>x</p>', '<meta http-equiv="refresh" content="0;url=/new/">'),
      config,
      site,
    });
    expect(redirect).toEqual({ skip: 'redirect' });

    const noindex = buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="robots" content="noindex">'),
      config,
      site,
    });
    expect(noindex).toEqual({ skip: 'noindex' });

    const token = buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="aeo" content="skip">'),
      config,
      site,
    });
    expect(token).toEqual({ skip: 'skip-token' });
  });

  test('respectNoindex: false keeps a noindex page', () => {
    const result = buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta name="robots" content="noindex">'),
      config: resolveConfig({ pages: { respectNoindex: false } }),
      site,
    });
    expect('page' in result).toBe(true);
  });

  test('relative links resolve against the page URL the record itself carries', () => {
    const result = buildPage({
      pathname: '/blog/post',
      html: page('<a href="../other/">Other</a>'),
      config,
      site,
    });
    expect(result.page.markdown).toContain('(https://x.com/blog/other/)');
  });

  test('article:modified_time becomes lastModified, and is otherwise undefined', () => {
    const dated = buildPage({
      pathname: '/x',
      html: page('<p>x</p>', '<meta property="article:modified_time" content="2026-02-15">'),
      config,
      site,
    });
    expect(dated.page.lastModified?.toISOString().slice(0, 10)).toBe('2026-02-15');

    const undated = buildPage({ pathname: '/x', html: page('<p>x</p>'), config, site });
    expect(undated.page.lastModified).toBeUndefined();
  });
});

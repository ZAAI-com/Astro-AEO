import { test, expect, describe } from 'vitest';
import {
  globToRegExp,
  inspectRootPathname,
  matchPath,
  isIncluded,
  normalizeCatalogPathname,
  normalizePath,
} from './match.js';

describe('normalizePath', () => {
  test('adds leading slash, drops trailing slash', () => {
    expect(normalizePath('about/')).toBe('/about');
    expect(normalizePath('/about/')).toBe('/about');
    expect(normalizePath('about')).toBe('/about');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('normalizeCatalogPathname', () => {
  test('accepts safe root-relative paths', () => {
    expect(normalizeCatalogPathname('/blog/post/')).toBe('/blog/post');
    expect(normalizeCatalogPathname('/caf%C3%A9')).toBe('/caf%C3%A9');
    expect(normalizeCatalogPathname('/sale-100%25')).toBe('/sale-100%25');
  });

  test.each([
    '/../llms.txt',
    '/safe/./page',
    '/%2e%2e/llms.txt',
    '/%252e%252e/llms.txt',
    '/safe%2f..%2fsecret',
    '//attacker.example/secret',
    '/%2f%2fattacker.example/secret',
    '/safe\\..\\secret',
    '/page?draft=true',
  ])('rejects unsafe catalog path %s', (pathname) => {
    expect(normalizeCatalogPathname(pathname)).toBeNull();
  });

  test('bounds repeated percent decoding', () => {
    expect(normalizeCatalogPathname('/%252525252e%252525252e/secret')).toBeNull();
  });
});

describe('inspectRootPathname', () => {
  test('returns the once-decoded request pathname', () => {
    expect(inspectRootPathname('/caf%C3%A9/')).toEqual({ decoded: '/café/' });
    expect(inspectRootPathname('/sale-100%25')).toEqual({ decoded: '/sale-100%' });
    expect(inspectRootPathname('/sale-%25beef')).toEqual({ decoded: '/sale-%beef' });
  });

  test('optionally preserves encoded question marks and fragments as path text', () => {
    expect(inspectRootPathname('/why%3Fnow%23yes')).toBeNull();
    expect(inspectRootPathname('/why%3Fnow%23yes', { allowEncodedReserved: true }))
      .toEqual({ decoded: '/why?now#yes' });
    expect(inspectRootPathname('/literal%253F', { allowEncodedReserved: true }))
      .toEqual({ decoded: '/literal%3F' });
    expect(inspectRootPathname('/raw?query', { allowEncodedReserved: true })).toBeNull();
    expect(inspectRootPathname('/safe%2Fsecret', { allowEncodedReserved: true })).toBeNull();
    expect(inspectRootPathname('/%2E%2E/secret', { allowEncodedReserved: true })).toBeNull();
    expect(inspectRootPathname('/bad%5Cpath', { allowEncodedReserved: true })).toBeNull();
  });

  test('rejects separators and traversal hidden behind repeated encoding', () => {
    expect(inspectRootPathname('/safe%252f..%252fsecret')).toBeNull();
    expect(inspectRootPathname('/%25252e%25252e/secret')).toBeNull();
    expect(inspectRootPathname('/%25zz/%252e%252e/secret')).toBeNull();
    expect(inspectRootPathname('/literal%25/%252fsecret')).toBeNull();
  });

  test('rejects encodings deeper than the double-encoded form', () => {
    expect(inspectRootPathname('/nested%252520space')).toBeNull();
  });
});

describe('globToRegExp', () => {
  test('* stays within a segment', () => {
    expect(globToRegExp('/*').test('/about')).toBe(true);
    expect(globToRegExp('/*').test('/blog/post')).toBe(false);
  });

  test('** crosses segments and matches the base', () => {
    expect(globToRegExp('/blog/**').test('/blog')).toBe(true);
    expect(globToRegExp('/blog/**').test('/blog/post')).toBe(true);
    expect(globToRegExp('/blog/**').test('/blog/a/b')).toBe(true);
    expect(globToRegExp('/blog/**').test('/blogging')).toBe(false);
  });

  test('character classes', () => {
    expect(globToRegExp('/20[0-9][0-9]/*').test('/2026/post')).toBe(true);
    expect(globToRegExp('/20[0-9][0-9]/*').test('/abcd/post')).toBe(false);
  });
});

describe('matchPath boundary safety', () => {
  test('/error matches /error but NOT /error-log', () => {
    expect(matchPath('/error', '/error')).toBe(true);
    expect(matchPath('/error/', '/error')).toBe(true);
    expect(matchPath('/error-log', '/error')).toBe(false);
  });

  test('trailing slash on the glob is normalized', () => {
    expect(matchPath('/error', '/error/')).toBe(true);
    expect(matchPath('/error-log', '/error/')).toBe(false);
  });

  test('descendants require an explicit ** glob', () => {
    expect(matchPath('/error/detail', '/error')).toBe(false);
    expect(matchPath('/error/detail', '/error/**')).toBe(true);
  });

  test('RegExp patterns', () => {
    expect(matchPath('/2026/post', /^\/\d{4}\/[^/]+$/)).toBe(true);
    expect(matchPath('/about', /^\/\d{4}\/[^/]+$/)).toBe(false);
  });

  test('array of globs (any match)', () => {
    expect(matchPath('/about', ['/contact', '/about'])).toBe(true);
    expect(matchPath('/team', ['/contact', '/about'])).toBe(false);
  });
});

describe('isIncluded', () => {
  test('defaults to include everything', () => {
    expect(isIncluded('/anything')).toBe(true);
  });

  test('exclude wins over include', () => {
    expect(isIncluded('/private/x', { exclude: ['/private/**'] })).toBe(false);
    expect(isIncluded('/public/x', { exclude: ['/private/**'] })).toBe(true);
  });

  test('include restricts the set', () => {
    expect(isIncluded('/docs/x', { include: ['/docs/**'] })).toBe(true);
    expect(isIncluded('/blog/x', { include: ['/docs/**'] })).toBe(false);
  });
});

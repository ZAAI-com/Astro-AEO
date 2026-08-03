import { test, expect, describe } from 'vitest';
import { globToRegExp, matchPath, isIncluded, normalizePath } from './match.js';

describe('normalizePath', () => {
  test('adds leading slash, drops trailing slash', () => {
    expect(normalizePath('about/')).toBe('/about');
    expect(normalizePath('/about/')).toBe('/about');
    expect(normalizePath('about')).toBe('/about');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
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

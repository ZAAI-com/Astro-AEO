import { describe, expect, test } from 'vitest';
import {
  assertExactPathname,
  exactPathnameIdentity,
  matchesExactPathname,
} from './artifact-path.js';

describe('exact artifact pathnames', () => {
  test.each([
    ['/feed.txt', { pathname: '/feed.txt', key: '/feed.txt' }],
    ['/caf%C3%A9.json', { pathname: '/caf%C3%A9.json', key: '/café.json' }],
    ['/sale-100%25.txt', { pathname: '/sale-100%25.txt', key: '/sale-100%.txt' }],
  ])('preserves %s while returning its request key', (pathname, expected) => {
    expect(exactPathnameIdentity(pathname)).toEqual(expected);
  });

  test.each([
    '/', '//feed.txt', '/a//b', '/a/', '/a/../b', '/a/%2e%2e/b',
    '/a%2fb', '/feed?x', '/feed#x', '/feed*.txt', '/café.json',
    '/caf%c3%a9.json', '/literal%2520escape.txt',
  ])('rejects ambiguous or unsafe pathname %s', (pathname) => {
    expect(() => assertExactPathname(pathname)).toThrow(TypeError);
  });

  test('matches encoded public and decoded request spellings only', () => {
    expect(matchesExactPathname('/café.json', '/caf%C3%A9.json')).toBe(true);
    expect(matchesExactPathname('/caf%C3%A9.json', '/caf%C3%A9.json')).toBe(true);
    expect(matchesExactPathname('/sale-100%.txt', '/sale-100%25.txt')).toBe(true);
    expect(matchesExactPathname('/caf%c3%a9.json', '/caf%C3%A9.json')).toBe(false);
    expect(matchesExactPathname('/other.json', '/caf%C3%A9.json')).toBe(false);
  });
});

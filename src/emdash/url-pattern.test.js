import { describe, expect, test } from 'vitest';
import { interpolateUrlPattern, parseEmDashDate, urlPatternGlob } from './url-pattern.js';

describe('interpolateUrlPattern', () => {
  test('resolves slug and id tokens with URI encoding', () => {
    expect(interpolateUrlPattern({ pattern: '/posts/{slug}', slug: 'hello-world' })).toBe('/posts/hello-world');
    expect(interpolateUrlPattern({ pattern: '/{slug}', slug: 'about' })).toBe('/about');
    expect(interpolateUrlPattern({ pattern: '/p/{id}/{slug}', slug: 'a b', id: '01H/X' })).toBe('/p/01H%2FX/a%20b');
  });

  test('resolves date tokens from the publish date in UTC', () => {
    expect(
      interpolateUrlPattern({ pattern: '/blog/{year}/{month}/{day}/{slug}', slug: 'x', date: '2026-01-05T23:30:00Z' }),
    ).toBe('/blog/2026/01/05/x');
    // An offsetless SQLite datetime is UTC, not the server's local time.
    expect(
      interpolateUrlPattern({ pattern: '/{year}/{month}/{day}/{hour}{minute}{second}/{slug}', slug: 'x', date: '2026-12-31 23:59:58' }),
    ).toBe('/2026/12/31/235958/x');
  });

  test('returns null instead of emitting an unresolved token', () => {
    expect(interpolateUrlPattern({ pattern: '/blog/{year}/{slug}', slug: 'x', date: null })).toBeNull();
    expect(interpolateUrlPattern({ pattern: '/blog/{year}/{slug}', slug: 'x', date: 'not a date' })).toBeNull();
    expect(interpolateUrlPattern({ pattern: '/p/{id}', slug: 'x' })).toBeNull();
    expect(interpolateUrlPattern({ pattern: '/p/{locale}/{slug}', slug: 'x' })).toBeNull();
  });

  test('does not read a brace in a slug as a token', () => {
    expect(interpolateUrlPattern({ pattern: '/posts/{slug}', slug: '{year}' })).toBe('/posts/%7Byear%7D');
  });

  test('normalizes slashes like EmDash', () => {
    expect(interpolateUrlPattern({ pattern: 'posts//{slug}/', slug: 'x' })).toBe('/posts/x');
  });
});

describe('parseEmDashDate', () => {
  test('parses ISO and offsetless values and rejects the rest', () => {
    expect(parseEmDashDate('2026-05-08 10:00:00')?.toISOString()).toBe('2026-05-08T10:00:00.000Z');
    expect(parseEmDashDate('2026-05-08T10:00:00+02:00')?.toISOString()).toBe('2026-05-08T08:00:00.000Z');
    expect(parseEmDashDate('')).toBeNull();
    expect(parseEmDashDate(undefined)).toBeNull();
    expect(parseEmDashDate('garbage')).toBeNull();
  });
});

describe('urlPatternGlob', () => {
  test.each([
    ['/posts/{slug}', '/posts/**'],
    ['/work/{slug}', '/work/**'],
    ['/blog/{year}/{month}/{slug}', '/blog/**'],
    ['/docs/guides/{slug}', '/docs/guides/**'],
    ['/posts-{slug}', null],
    ['/{slug}', null],
    ['/{year}/{slug}', null],
  ])('%s -> %s', (pattern, glob) => {
    expect(urlPatternGlob(pattern)).toBe(glob);
  });
});

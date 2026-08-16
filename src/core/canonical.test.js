import { describe, expect, test } from 'vitest';
import { authoredCanonical, configuredCanonical, siteScopeUrl, stableCanonical } from './canonical.js';

describe('stable canonicals', () => {
  test('accepts public HTTP URLs and removes fragments', () => {
    expect(stableCanonical('https://example.com/post#part')).toBe('https://example.com/post');
  });

  test.each([
    'http://localhost/post',
    'http://127.0.0.1/post',
    'http://[::ffff:127.0.0.1]/post',
    'http://0.0.0.0/post',
    'https://user:secret@example.com/post',
    'javascript:alert(1)',
    '/relative',
  ])('rejects unstable canonical %s', (value) => {
    expect(stableCanonical(value)).toBeUndefined();
  });

  test('accepts one authored canonical and reports conflicts', () => {
    expect(authoredCanonical('<html><head><link rel="canonical" href="/one"></head></html>', 'https://example.com')).toMatchObject({
      canonical: 'https://example.com/one', conflict: false,
    });
    expect(authoredCanonical(
      '<html><head><link rel="canonical" href="https://example.com/one"><link href="https://example.com/two" rel="canonical"></head></html>',
    ).conflict).toBe(true);
  });

  test('decodes exactly one character-reference layer in authored hrefs', () => {
    expect(authoredCanonical(
      '<html><head><link rel="canonical" href="/search?a=1&amp;b=2&#38;c=3&#x26;d=4"></head></html>',
      'https://example.com',
    ).canonical).toBe('https://example.com/search?a=1&b=2&c=3&d=4');
    expect(authoredCanonical(
      '<html><head><link rel="canonical" href="/search?a=1&amp;amp;b=2"></head></html>',
      'https://example.com',
    ).canonical).toBe('https://example.com/search?a=1&amp;b=2');
  });

  test('builds configured canonicals with base and trailing slash policy', () => {
    expect(configuredCanonical(
      { siteUrl: 'https://example.com', base: '/docs', trailingSlash: 'always' },
      '/guide',
    )).toBe('https://example.com/docs/guide/');
  });

  test('builds a stable site validation scope that retains the Astro base', () => {
    expect(siteScopeUrl('https://example.com', '/docs')).toBe('https://example.com/docs/');
    expect(siteScopeUrl('https://example.com/site', '')).toBe('https://example.com/');
    expect(siteScopeUrl('http://localhost', '/docs')).toBeUndefined();
  });
});

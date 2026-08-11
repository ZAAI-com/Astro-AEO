import { describe, expect, test } from 'vitest';
import { authoredCanonical, configuredCanonical, stableCanonical } from './canonical.js';

describe('stable canonicals', () => {
  test('accepts public HTTP URLs and removes fragments', () => {
    expect(stableCanonical('https://example.com/post#part')).toBe('https://example.com/post');
  });

  test.each([
    'http://localhost/post',
    'http://127.0.0.1/post',
    'https://user:secret@example.com/post',
    'javascript:alert(1)',
    '/relative',
  ])('rejects unstable canonical %s', (value) => {
    expect(stableCanonical(value)).toBeUndefined();
  });

  test('accepts one authored canonical and reports conflicts', () => {
    expect(authoredCanonical('<link rel="canonical" href="/one">', 'https://example.com')).toMatchObject({
      canonical: 'https://example.com/one', conflict: false,
    });
    expect(authoredCanonical(
      '<link rel="canonical" href="https://example.com/one"><link href="https://example.com/two" rel="canonical">',
    ).conflict).toBe(true);
  });

  test('builds configured canonicals with base and trailing slash policy', () => {
    expect(configuredCanonical(
      { siteUrl: 'https://example.com', base: '/docs', trailingSlash: 'always' },
      '/guide',
    )).toBe('https://example.com/docs/guide/');
  });
});

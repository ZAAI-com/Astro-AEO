import { describe, expect, test } from 'vitest';
import { resolveEntityId } from './entity-id.js';

const page = new URL('https://demo.example.com/faq/');

describe('resolveEntityId', () => {
  test('resolves a fragment against the page URL', () => {
    expect(resolveEntityId('#faq', page)).toBe('https://demo.example.com/faq/#faq');
  });

  test('keeps an absolute URL', () => {
    expect(resolveEntityId('https://other.example.com/x#faq', page)).toBe('https://other.example.com/x#faq');
  });

  test('keeps a fragment on a page whose URL already had one', () => {
    expect(resolveEntityId('#faq', new URL('https://demo.example.com/faq/#top'))).toBe('https://demo.example.com/faq/#faq');
  });

  test.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['the page itself', './'],
    ['an empty fragment', '#'],
    ['the page by absolute URL', 'https://demo.example.com/faq/'],
    ['an unparseable URL', 'http://['],
    ['a non-string', 42],
    ['nothing', undefined],
  ])('drops %s', (_label, id) => {
    expect(resolveEntityId(id, page)).toBeUndefined();
  });

  test('without a site, returns a non-blank id as written', () => {
    expect(resolveEntityId('#faq')).toBe('#faq');
    expect(resolveEntityId('./')).toBe('./');
    expect(resolveEntityId('  ')).toBeUndefined();
  });
});

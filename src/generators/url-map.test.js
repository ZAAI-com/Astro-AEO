import { test, expect, describe } from 'vitest';
import { resolve } from 'node:path';
import { resolveWithinRoot } from './url-map.js';

describe('resolveWithinRoot', () => {
  const ROOT = '/home/user/proj';

  test('resolves an in-root path', () => {
    expect(resolveWithinRoot(ROOT, 'docs/Url-Map.md')).toBe(resolve(ROOT, 'docs/Url-Map.md'));
  });

  test('allows the project root itself', () => {
    expect(resolveWithinRoot(ROOT, '.')).toBe(resolve(ROOT));
  });

  test('rejects a parent-directory escape', () => {
    expect(() => resolveWithinRoot(ROOT, '../secrets/x.md')).toThrow(/escapes the project root/);
  });

  test('rejects a sibling sharing the root name prefix', () => {
    expect(() => resolveWithinRoot(ROOT, '../proj-secrets/x.md')).toThrow(/escapes the project root/);
  });
});

import { test, expect, describe } from 'vitest';
import { deepMerge, getPath, isPlainObject, setPath } from './object-path.js';

describe('isPlainObject', () => {
  test('accepts config literals', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  test('rejects the shapes that look like objects but are not traversable', () => {
    // The naive typeof check treats all four as objects; a RegExp reaching the
    // walker is the one that actually bites, since stripTitleSuffix may be one.
    expect(isPlainObject(/re/)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe('getPath / setPath', () => {
  test('reads and writes dotted paths', () => {
    expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    const out = {};
    setPath(out, 'a.b.c', 1);
    expect(out).toEqual({ a: { b: { c: 1 } } });
  });

  test('reading through a missing or non-object segment is undefined, not a throw', () => {
    expect(getPath({}, 'a.b.c')).toBeUndefined();
    expect(getPath({ a: /re/ }, 'a.source')).toBeUndefined();
    expect(getPath(undefined, 'a')).toBeUndefined();
  });

  test('setPath replaces a non-object intermediate rather than writing onto it', () => {
    const out = { a: 5 };
    setPath(out, 'a.b', 1);
    expect(out).toEqual({ a: { b: 1 } });
  });
});

describe('deepMerge', () => {
  test('recurses into plain objects and replaces everything else wholesale', () => {
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } })).toEqual({ a: { b: 1, c: 3 } });
    expect(deepMerge({ a: ['x', 'y'] }, { a: ['z'] })).toEqual({ a: ['z'] });
    expect(deepMerge({ a: /x/ }, { a: /y/ })).toEqual({ a: /y/ });
  });

  test('an explicit undefined does not erase a base value', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});

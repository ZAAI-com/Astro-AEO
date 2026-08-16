import { describe, expect, test } from 'vitest';
import { cloneJsonValue, deepFreeze, immutableJsonValue } from './json-value.js';

describe('strict JSON values', () => {
  test('clones plain data without retaining caller state', () => {
    const source = { nested: [{ answer: 42 }] };
    const clone = cloneJsonValue(source);
    source.nested[0].answer = 7;
    expect(clone).toEqual({ nested: [{ answer: 42 }] });
  });

  test.each([
    undefined,
    () => {},
    Number.NaN,
    Infinity,
    new Date(),
    new Map(),
    [, 'sparse'],
  ])('rejects non-JSON input %#', (value) => {
    expect(() => cloneJsonValue(value)).toThrow(TypeError);
  });

  test('rejects cycles, accessors, and prototype-sensitive keys', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => cloneJsonValue(cyclic)).toThrow(/cycles/);
    expect(() => cloneJsonValue(Object.defineProperty({}, 'secret', { get() { return 1; }, enumerable: true })))
      .toThrow(/accessor/);
    expect(() => cloneJsonValue(JSON.parse('{"__proto__":true}'))).toThrow(/forbidden/);
  });

  test('immutable clones are deeply frozen', () => {
    const value = immutableJsonValue({ nested: ['safe'] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
  });

  test('deepFreeze includes callable values and their properties', () => {
    const callable = Object.assign(() => {}, { options: { enabled: true } });
    deepFreeze(callable);
    expect(Object.isFrozen(callable)).toBe(true);
    expect(Object.isFrozen(callable.options)).toBe(true);
  });

  test('deepFreeze traverses frozen parents and terminates cycles', () => {
    const child = { enabled: true };
    const parent = Object.freeze({ child });
    /** @type {any} */
    const cycle = { parent };
    cycle.self = cycle;

    expect(deepFreeze(cycle)).toBe(cycle);
    expect(Object.isFrozen(cycle)).toBe(true);
    expect(Object.isFrozen(child)).toBe(true);
  });
});

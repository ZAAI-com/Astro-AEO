import { test, expect, describe } from 'vitest';
import { findNonSerializable, nonSerializableWarning, runtimeConfigProjection, toSource } from './serialize.js';
import { resolveConfig } from '../config.js';

/** Evaluate emitted source the way the virtual module's importer would. */
const roundTrip = (value) => new Function(`return (${toSource(value)});`)();

describe('toSource', () => {
  test('round-trips the shapes JSON handles', () => {
    const value = { a: 1, b: 'two', c: true, d: null, e: [1, 2], f: { g: 'h' } };
    expect(roundTrip(value)).toEqual(value);
  });

  test('round-trips a RegExp, which JSON would flatten to {}', () => {
    const out = roundTrip({ strip: /\s*\|\s*Demo$/i });
    expect(out.strip).toBeInstanceOf(RegExp);
    expect(out.strip.source).toBe('\\s*\\|\\s*Demo$');
    expect(out.strip.flags).toBe('i');
  });

  test('round-trips a Set and a Date', () => {
    const out = roundTrip({ tokens: new Set(['a', 'b']), at: new Date('2026-02-15T00:00:00.000Z') });
    expect(out.tokens).toBeInstanceOf(Set);
    expect([...out.tokens]).toEqual(['a', 'b']);
    expect(out.at.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  test('a key whose value is a function is dropped, not emitted as null', () => {
    // The runtime must see an absent option, so its own default applies.
    const out = roundTrip({ keep: 'yes', match: () => true });
    expect(out).toEqual({ keep: 'yes' });
    expect('match' in out).toBe(false);
  });

  test('a function inside an array becomes undefined, preserving position', () => {
    const out = roundTrip([{ title: 'A', match: '/a' }, { title: 'B', match: () => true }]);
    expect(out).toHaveLength(2);
    expect(out[1].title).toBe('B');
    expect(out[1].match).toBeUndefined();
  });

  test('strings that could break out of the emitted source are escaped', () => {
    const nasty = { s: '</script> "\'`${x}\\' };
    expect(roundTrip(nasty)).toEqual(nasty);
  });

  test('a real resolved config survives the round trip', () => {
    const config = resolveConfig({
      pages: { stripTitleSuffix: /\s\|\sX$/ },
      corpus: { index: { sections: [{ title: 'Home', match: '/' }] } },
      discovery: { robots: { enabled: true, allow: ['Googlebot'] } },
    });
    const out = roundTrip(config);
    expect(out.discovery.robots.allow).toEqual(['Googlebot']);
    expect(out.discovery.robots.sitemapPolicy).toBe('auto');
    expect(out.corpus.index.sections[0]).toEqual({ title: 'Home', match: '/' });
    expect(out.pages.stripTitleSuffix).toBeInstanceOf(RegExp);
    expect(out.markdown.extraction.selectors).toEqual(['article', 'main']);
  });
});

describe('findNonSerializable', () => {
  test('reports functions by dotted path', () => {
    const config = resolveConfig({
      corpus: { index: { sections: [{ title: 'Home', match: '/' }, { title: 'X', match: () => true }] } },
    });
    expect(findNonSerializable(config)).toEqual(['corpus.index.sections[1].match']);
  });

  test('a fully serializable config reports nothing', () => {
    expect(findNonSerializable(resolveConfig())).toEqual([]);
  });

  test('regular expressions, dates and sets are serializable', () => {
    expect(findNonSerializable({ a: /x/, b: new Date(0), c: new Set([1]) })).toEqual([]);
  });

  test('a class instance is reported, since only plain objects survive', () => {
    class Thing {}
    expect(findNonSerializable({ thing: new Thing() })).toEqual(['thing']);
  });

  test('the warning names the paths and says what actually happens', () => {
    const message = nonSerializableWarning(['corpus.index.sections[1].match']);
    expect(message).toContain('corpus.index.sections[1].match');
    expect(message).toContain('still apply during `astro build`');
    expect(message).toContain('skipped in `astro dev`');
    expect(message).toContain('falls through to the default');
  });
});

describe('runtimeConfigProjection', () => {
  test('removes build-only sitemap options without mutating the resolved config', () => {
    const config = resolveConfig({
      discovery: { sitemap: { options: { filter: () => true, locales: { 'pt-BR': 'pt' } } } },
    });
    const projected = runtimeConfigProjection(config);
    expect(projected.discovery.sitemap.options).toEqual({});
    expect(config.discovery.sitemap.options.locales).toEqual({ 'pt-BR': 'pt' });
    expect(findNonSerializable(projected)).toEqual([]);
  });
});

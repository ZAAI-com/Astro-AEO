import { test, expect, describe } from 'vitest';
import { LEGACY_MOVES, MIGRATION_GUIDE, REMOVED_TOP_LEVEL, assertNoRemovedKeys, liftLegacy, printMigration } from './config-removed.js';
import { getPath, setPath } from './object-path.js';
import { AeoConfigError } from './errors.js';
import { resolveConfig } from '../config.js';

/** @param {() => void} fn @returns {string} */
function errorText(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AeoConfigError);
    return String(/** @type {Error} */ (err).message);
  }
  throw new Error('expected an AeoConfigError');
}

/** @param {string} message @returns {Record<string, any>} */
function pastedBlock(message) {
  const start = message.indexOf('Replace them with:\n\n');
  expect(start).toBeGreaterThan(-1);
  const block = message.slice(start + 'Replace them with:\n\n'.length).split('\n\n')[0];
  return new Function(`return ({\n${block}\n});`)();
}

describe('LEGACY_MOVES', () => {
  test('every 1.0 key has exactly one move row', () => {
    const froms = LEGACY_MOVES.map((m) => m.from);
    expect(new Set(froms).size).toBe(froms.length);
  });

  test('every move names the canonical section it lands in', () => {
    for (const move of LEGACY_MOVES) {
      expect(move.section, move.from).toBeTruthy();
      expect(move.to.startsWith(move.section === 'site.profile' ? 'site.' : move.section)).toBe(true);
    }
  });

  test('only the two 1.0-era aliases are superseded', () => {
    const superseded = LEGACY_MOVES.filter((m) => m.supersededBy).map((m) => m.from);
    expect(superseded).toEqual(['dotmd.dotmdMetadata', 'domainProfile.contact']);
  });

  test('covers the twelve removed top-level names', () => {
    expect(REMOVED_TOP_LEVEL).toEqual([
      'include', 'exclude', 'respectNoindex', 'stripTitleSuffix', 'dotmd', 'llmsTxt', 'llmsFullTxt',
      'urlMap', 'sitemap', 'sitemapAlias', 'robotsTxt', 'domainProfile',
    ]);
  });
});

describe('liftLegacy', () => {
  test('rewrites 1.0 keys onto canonical paths', () => {
    const { lifted } = liftLegacy({
      include: ['**'],
      dotmd: { linkTag: 'never', frontmatter: true },
      llmsTxt: { showLastmod: true, includeNoDotmd: true },
    });
    expect(lifted).toEqual({
      pages: { include: ['**'] },
      markdown: { alternateLink: 'never', frontmatter: true },
      corpus: { index: { showLastModified: true, includeHtmlOnly: true } },
    });
  });

  test('absence survives the lift, so the sitemap tri-state is not collapsed', () => {
    expect(liftLegacy({ robotsTxt: { enabled: true } }).lifted).toEqual({
      discovery: { robots: { enabled: true } },
    });
    // Explicit undefined must behave exactly like an omitted key.
    expect(liftLegacy({ robotsTxt: { includeSitemap: undefined } }).lifted).toEqual({});
  });

  test('sitemap.enabled maps to a mode, and false means external rather than off', () => {
    expect(getPath(liftLegacy({ sitemap: { enabled: true } }).lifted, 'discovery.sitemap.mode')).toBe('auto');
    expect(getPath(liftLegacy({ sitemap: { enabled: false } }).lifted, 'discovery.sitemap.mode')).toBe('external');
  });

  test('the 1.0-era aliases keep their original precedence', () => {
    const both = liftLegacy({ dotmd: { frontmatter: true, dotmdMetadata: false } });
    expect(getPath(both.lifted, 'markdown.frontmatter')).toBe(true);
    const aliasOnly = liftLegacy({ dotmd: { dotmdMetadata: true } });
    expect(getPath(aliasOnly.lifted, 'markdown.frontmatter')).toBe(true);

    const contact = liftLegacy({ domainProfile: { email: 'a@b.c', contact: 'z@z.z' } });
    expect(getPath(contact.lifted, 'site.profile.email')).toBe('a@b.c');
  });
});

describe('assertNoRemovedKeys', () => {
  test('canonical and empty input pass', () => {
    expect(() => assertNoRemovedKeys({})).not.toThrow();
    expect(() => assertNoRemovedKeys({ pages: { exclude: ['/x'] }, markdown: { frontmatter: true } })).not.toThrow();
  });

  test('a key set to undefined is ignored, as an omitted key is', () => {
    expect(() => assertNoRemovedKeys({ exclude: undefined, dotmd: undefined })).not.toThrow();
  });

  test('a removed block is rejected even when every key inside it is undefined', () => {
    expect(errorText(() => assertNoRemovedKeys({ robotsTxt: { includeSitemap: undefined } }))).toContain(
      '  robotsTxt -> discovery.robots',
    );
  });

  test('names every removed path with its canonical path, in one error', () => {
    const message = errorText(() =>
      assertNoRemovedKeys({
        exclude: ['/private/**'],
        dotmd: { linkTag: 'never' },
        llmsTxt: { showLastmod: true },
        domainProfile: { contact: 'team@example.com' },
      }),
    );
    expect(message).toContain('these 1.0 configuration keys were removed in 2.0:');
    expect(message).toContain('  exclude -> pages.exclude');
    expect(message).toContain('  dotmd.linkTag -> markdown.alternateLink');
    expect(message).toContain('  llmsTxt.showLastmod -> corpus.index.showLastModified');
    expect(message).toContain('  domainProfile.contact -> site.profile.email');
    expect(message).toContain(MIGRATION_GUIDE);
  });

  test('lists both spellings of a superseded alias but prints the winning value', () => {
    const message = errorText(() =>
      assertNoRemovedKeys({
        dotmd: { frontmatter: true, dotmdMetadata: false },
        domainProfile: { email: 'a@example.com', contact: 'z@example.com' },
      }),
    );
    expect(message).toContain('dotmd.frontmatter -> markdown.frontmatter');
    expect(message).toContain('dotmd.dotmdMetadata -> markdown.frontmatter');
    expect(message).toContain('domainProfile.contact -> site.profile.email');
    expect(pastedBlock(message)).toEqual({
      markdown: { frontmatter: true },
      site: { profile: { email: 'a@example.com' } },
    });
  });

  test('explains a mapped value', () => {
    const message = errorText(() => assertNoRemovedKeys({ sitemap: { enabled: false } }));
    expect(message).toContain('sitemap.enabled -> discovery.sitemap.mode (false becomes "external")');
    expect(pastedBlock(message)).toEqual({ discovery: { sitemap: { mode: 'external' } } });
  });

  test('rejects a removed block with no recognized key inside', () => {
    expect(errorText(() => assertNoRemovedKeys({ dotmd: {} }))).toContain('  dotmd -> markdown');
    expect(errorText(() => assertNoRemovedKeys({ sitemap: true }))).toContain('  sitemap -> discovery.sitemap');
    expect(errorText(() => assertNoRemovedKeys({ domainProfile: { unknown: 1 } }))).toContain(
      '  domainProfile -> site.profile',
    );
  });

  test('prints function values as placeholders', () => {
    const message = errorText(() =>
      assertNoRemovedKeys({ llmsTxt: { sections: [{ title: 'Blog', match: () => true }] } }),
    );
    expect(message).toContain('undefined /* TODO */');
    expect(message).toContain('copy those by hand');
  });

  test('resolveConfig runs the guard before anything else', () => {
    const warnings = [];
    const message = errorText(() =>
      resolveConfig({ include: ['**'], unknownKey: true }, { warn: (m) => warnings.push(m) }),
    );
    expect(message).toContain('include -> pages.include');
    expect(warnings).toEqual([]);
  });
});

describe('printMigration', () => {
  test('renders a paste-ready canonical block', () => {
    const out = printMigration({
      exclude: ['/private/**'],
      dotmd: { frontmatter: true },
      domainProfile: { enabled: true, name: 'Acme' },
    });
    expect(out).toContain('canonical replacement for your 1.0 keys');
    expect(out).toContain('pages: {');
    expect(out).toContain('exclude: ["/private/**"],');
    expect(out).toContain('markdown: {');
    expect(out).toContain('frontmatter: true,');
    expect(out).toContain('site: {');
    expect(out).toContain('profile: {');
    expect(out).toContain("name: \"Acme\",");
  });

  test('maps values that changed shape, not just name', () => {
    expect(printMigration({ sitemap: { enabled: false } })).toContain('mode: "external",');
  });

  test('flags values that cannot be serialized', () => {
    const out = printMigration({ llmsTxt: { sections: [{ title: 'Blog', match: () => true }] } });
    expect(out).toContain('undefined /* TODO */');
    expect(out).toContain('copy those by hand');
  });

  test('emits syntactically valid JavaScript for passthrough values', () => {
    const out = printMigration({
      sitemap: {
        options: {
          locales: { 'pt-BR': new Date('2026-01-01T00:00:00.000Z') },
          nested: { ['__proto__']: { safe: true } },
          pattern: /^blog$/i,
        },
      },
    });
    const block = out.split('\n\n')[1];
    expect(() => new Function(`return ({\n${block}\n});`)()).not.toThrow();
    expect(block).toContain('"pt-BR": new Date("2026-01-01T00:00:00.000Z")');
    expect(block).toContain('["__proto__"]: {');
    expect(block).toContain('new RegExp("^blog$", "i")');
    const migrated = new Function(`return ({\n${block}\n});`)();
    expect(Object.hasOwn(migrated.discovery.sitemap.options.nested, '__proto__')).toBe(true);
  });

  test('preserves nested JavaScript numeric values', () => {
    const out = printMigration({
      sitemap: {
        options: {
          values: [Number.NaN, Infinity, -Infinity, -0, 42n, new Date(Number.NaN)],
        },
      },
    });
    const block = out.split('\n\n')[1];
    const migrated = new Function(`return ({\n${block}\n});`)();
    const values = migrated.discovery.sitemap.options.values;
    expect(Number.isNaN(values[0])).toBe(true);
    expect(values[1]).toBe(Infinity);
    expect(values[2]).toBe(-Infinity);
    expect(Object.is(values[3], -0)).toBe(true);
    expect(values[4]).toBe(42n);
    expect(Number.isNaN(values[5].getTime())).toBe(true);
  });

  test('returns null when there is nothing to migrate', () => {
    expect(printMigration({})).toBeNull();
    expect(printMigration({ markdown: { frontmatter: true } })).toBeNull();
  });
});

// Every removed spelling fails, and the block the error prints resolves to the
// same configuration the 1.x alias produced.
describe('complete removed-key rejection', () => {
  const defaults = resolveConfig();
  for (const move of LEGACY_MOVES) {
    test(`${move.from} is rejected in favor of ${move.to}`, () => {
      const value = move.map ? false : getPath(defaults, move.to);
      expect(value, `Missing representative value for ${move.to}`).not.toBeUndefined();
      const legacy = {};
      const canonical = {};
      setPath(legacy, move.from, value);
      setPath(canonical, move.to, move.map ? move.map(value) : value);
      const message = errorText(() => resolveConfig(legacy));
      expect(message).toContain(`  ${move.from} -> ${move.to}`);
      expect(resolveConfig(pastedBlock(message))).toEqual(resolveConfig(canonical));
    });
  }
});

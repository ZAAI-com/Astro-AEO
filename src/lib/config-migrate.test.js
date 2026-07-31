import { test, expect, describe } from 'vitest';
import {
  LEGACY_MOVES,
  configEqual,
  deepMerge,
  describeValue,
  getPath,
  isPlainObject,
  liftLegacy,
  mergeLegacy,
  setPath,
  truncate,
} from './config-migrate.js';
import { AeoConfigError } from './errors.js';

/** @param {string} m */
const throwing = (m) => {
  throw new AeoConfigError(m);
};

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

describe('configEqual', () => {
  test('compares regular expressions by source and flags', () => {
    expect(configEqual(/a/i, /a/i)).toBe(true);
    expect(configEqual(/a/i, /a/g)).toBe(false);
  });

  test('compares arrays and plain objects structurally', () => {
    expect(configEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(configEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(configEqual({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true);
    expect(configEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test('compares functions by reference, because deep equality is impossible', () => {
    const fn = () => true;
    expect(configEqual(fn, fn)).toBe(true);
    expect(configEqual(() => true, () => true)).toBe(false);
  });

  test('compares dates by time', () => {
    expect(configEqual(new Date(0), new Date(0))).toBe(true);
    expect(configEqual(new Date(0), new Date(1))).toBe(false);
  });
});

describe('describeValue', () => {
  test('renders functions and regular expressions that JSON.stringify would drop', () => {
    expect(describeValue(function named() {})).toBe('[Function: named]');
    expect(describeValue(/^\/blog/i)).toBe('/^\\/blog/i');
    expect(describeValue([{ match: () => true }])).toContain('[Function');
  });

  test('renders scalars and arrays as JSON-ish text', () => {
    expect(describeValue('x')).toBe('"x"');
    expect(describeValue(false)).toBe('false');
    expect(describeValue(['a', 'b'])).toBe('["a", "b"]');
  });

  test('truncate caps a long value', () => {
    expect(truncate('x'.repeat(200))).toHaveLength(120);
  });
});

describe('LEGACY_MOVES', () => {
  test('every 1.0 key has exactly one move row', () => {
    const froms = LEGACY_MOVES.map((m) => m.from);
    expect(new Set(froms).size).toBe(froms.length);
  });

  test('every move names a canonical section used for warning dedupe', () => {
    for (const move of LEGACY_MOVES) {
      expect(move.section, move.from).toBeTruthy();
      expect(move.to.startsWith(move.section === 'site.profile' ? 'site.' : move.section)).toBe(true);
    }
  });

  test('only the two 1.0-era aliases are superseded', () => {
    const superseded = LEGACY_MOVES.filter((m) => m.supersededBy).map((m) => m.from);
    expect(superseded).toEqual(['dotmd.dotmdMetadata', 'domainProfile.contact']);
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

describe('mergeLegacy', () => {
  test('legacy-only input warns once per canonical section', () => {
    const { merged, warnings } = mergeLegacy(
      { dotmd: { linkTag: 'never' }, llmsTxt: { showLastmod: true }, llmsFullTxt: { mode: 'index' } },
      throwing,
    );
    expect(getPath(merged, 'markdown.alternateLink')).toBe('never');
    expect(getPath(merged, 'corpus.full.mode')).toBe('index');
    expect(warnings).toHaveLength(2);
    expect(warnings.find((w) => w.includes('`markdown`'))).toContain('`dotmd` is deprecated');
    // llmsTxt and llmsFullTxt both land in corpus, so they share one warning.
    const corpus = warnings.find((w) => w.includes('`corpus`'));
    expect(corpus).toContain('`llmsTxt`, `llmsFullTxt`');
    expect(corpus).toContain('are deprecated');
  });

  test('canonical-only input produces no warnings', () => {
    const { merged, warnings } = mergeLegacy({ markdown: { alternateLink: 'never' } }, throwing);
    expect(getPath(merged, 'markdown.alternateLink')).toBe('never');
    expect(warnings).toEqual([]);
  });

  test('equal values on both sides use the canonical one and warn once', () => {
    const { merged, warnings } = mergeLegacy(
      { dotmd: { linkTag: 'never' }, markdown: { alternateLink: 'never' } },
      throwing,
    );
    expect(getPath(merged, 'markdown.alternateLink')).toBe('never');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('both set to the same values');
  });

  test('mixed non-conflicting input is allowed, and canonical wins per key', () => {
    const { merged, warnings } = mergeLegacy(
      { dotmd: { linkTag: 'never' }, markdown: { frontmatter: true } },
      throwing,
    );
    expect(getPath(merged, 'markdown.alternateLink')).toBe('never');
    expect(getPath(merged, 'markdown.frontmatter')).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('is deprecated');
  });

  test('conflicting values throw and name both paths', () => {
    expect(() =>
      mergeLegacy({ dotmd: { linkTag: 'never' }, markdown: { alternateLink: 'auto' } }, throwing),
    ).toThrow(AeoConfigError);

    try {
      mergeLegacy({ dotmd: { linkTag: 'never' }, markdown: { alternateLink: 'auto' } }, throwing);
    } catch (err) {
      expect(String(err)).toContain('dotmd.linkTag: "never"');
      expect(String(err)).toContain('markdown.alternateLink: "auto"');
      expect(String(err)).toContain('conflicting configuration');
    }
  });

  test('a mapped conflict shows the mapped value alongside the raw one', () => {
    try {
      mergeLegacy({ sitemap: { enabled: false }, discovery: { sitemap: { mode: 'auto' } } }, throwing);
      throw new Error('expected a conflict');
    } catch (err) {
      expect(String(err)).toContain('sitemap.enabled: false');
      expect(String(err)).toContain('maps to discovery.sitemap.mode: "external"');
    }
  });

  test('two separately written callbacks conflict even when the source matches', () => {
    expect(() =>
      mergeLegacy(
        {
          llmsTxt: { sections: [{ title: 'Blog', match: (p) => p.pathname === '/blog' }] },
          corpus: { index: { sections: [{ title: 'Blog', match: (p) => p.pathname === '/blog' }] } },
        },
        throwing,
      ),
    ).toThrow(AeoConfigError);
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

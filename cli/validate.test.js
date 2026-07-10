import { test, expect, describe, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateDist } from './validate.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const FIX = join(DIR, '..', 'fixtures');

describe('validateDist', () => {
  test('valid dist passes with no errors', () => {
    const r = validateDist(join(FIX, 'dist-valid'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pagesChecked).toBe(1);
  });

  test('broken dist reports the expected error codes', () => {
    const r = validateDist(join(FIX, 'dist-broken'));
    expect(r.ok).toBe(false);
    const errorCodes = r.errors.map((e) => e.code);
    expect(errorCodes).toContain('missing-md'); // llms.txt -> /ghost.md
    expect(errorCodes).toContain('dp-missing-field'); // domain-profile missing name

    const warnCodes = r.warnings.map((w) => w.code);
    expect(warnCodes).toContain('orphan-md'); // orphan.md
    expect(warnCodes).toContain('no-alternate-link'); // index.html has none
    expect(warnCodes).toContain('dp-relative-url'); // url not absolute
  });

  test('missing dist directory is a usage error', () => {
    const r = validateDist(join(FIX, 'does-not-exist'));
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('no-dist');
  });

  test('.md companion of a no-llms page is not flagged as orphan', () => {
    const r = validateDist(join(FIX, 'dist-nollms'));
    expect(r.ok).toBe(true);
    const warnCodes = r.warnings.map((w) => w.code);
    // secret.md is intentionally absent from llms.txt (page has aeo=no-llms)
    expect(warnCodes).not.toContain('orphan-md');
  });

  describe('markdown alternate link detection', () => {
    /** @type {string} */
    let tmp;

    afterEach(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    /** @param {string} head */
    const buildDist = (head) => {
      tmp = mkdtempSync(join(tmpdir(), 'aeo-validate-'));
      writeFileSync(join(tmp, 'index.html'), `<html><head>${head}</head><body>x</body></html>`);
      return tmp;
    };

    test('a type="text/markdown" link without rel="alternate" is not a valid alternate', () => {
      const r = validateDist(buildDist('<link type="text/markdown" href="/index.md">'));
      // Bare MIME-typed link must not satisfy the alternate-link requirement.
      expect(r.warnings.map((w) => w.code)).toContain('no-alternate-link');
    });

    test('a proper rel="alternate" markdown link satisfies the check', () => {
      const r = validateDist(buildDist('<link rel="alternate" type="text/markdown" href="/index.md">'));
      expect(r.warnings.map((w) => w.code)).not.toContain('no-alternate-link');
    });
  });

  describe('robots.txt wildcard-group validation', () => {
    /** @type {string} */
    let tmp;

    afterEach(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    /** @param {string} robots */
    const buildDist = (robots) => {
      tmp = mkdtempSync(join(tmpdir(), 'aeo-validate-'));
      writeFileSync(
        join(tmp, 'index.html'),
        '<html><head><link rel="alternate" type="text/markdown" href="/index.md"></head><body>x</body></html>',
      );
      writeFileSync(join(tmp, 'robots.txt'), robots);
      return tmp;
    };

    test('named groups without a wildcard warn', () => {
      const r = validateDist(buildDist('User-agent: Googlebot\nAllow: /\n'));
      expect(r.warnings.map((w) => w.code)).toContain('robots-no-wildcard');
    });

    test('a wildcard group silences the warning', () => {
      const r = validateDist(buildDist('User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nAllow: /\n'));
      expect(r.warnings.map((w) => w.code)).not.toContain('robots-no-wildcard');
    });

    test('disallow-only without a wildcard warns', () => {
      const r = validateDist(buildDist('User-agent: GPTBot\nDisallow: /\n'));
      expect(r.warnings.map((w) => w.code)).toContain('robots-no-wildcard');
    });

    test('an inline comment after "User-agent: *" is not mistaken for a named agent', () => {
      const r = validateDist(buildDist('User-agent: * # default crawlers\nAllow: /\n\nUser-agent: Googlebot\nAllow: /\n'));
      expect(r.warnings.map((w) => w.code)).not.toContain('robots-no-wildcard');
    });
  });

  describe('on-page audit validation', () => {
    // Track every temp dir so tests that call buildDist more than once still get
    // all of them cleaned up (a single `tmp` would leak the earlier ones).
    /** @type {string[]} */
    const tmps = [];

    afterEach(() => {
      while (tmps.length) rmSync(/** @type {string} */ (tmps.pop()), { recursive: true, force: true });
    });

    /**
     * @param {string} head
     * @param {string} [body]
     */
    const buildDist = (head, body = '<main><p>Fixture page.</p></main>') => {
      const tmp = mkdtempSync(join(tmpdir(), 'aeo-validate-'));
      tmps.push(tmp);
      writeFileSync(join(tmp, 'index.html'), `<html><head>${head}</head><body>${body}</body></html>`);
      return tmp;
    };

    const cleanHead = [
      '<title>Valid Test Page With Metadata Set</title>',
      '<meta name="robots" content="index,follow">',
      '<meta property="og:title" content="Valid Test Page With Metadata Set">',
      '<meta property="og:description" content="A focused validation fixture with complete social metadata for crawler previews.">',
      '<meta property="og:image" content="https://example.com/og-image.png">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<link rel="alternate" type="text/markdown" href="/index.md">',
    ].join('');

    /** @param {{ errors: { code: string }[]; warnings: { code: string }[] }} result */
    const codes = (result) => [...result.errors, ...result.warnings].map((f) => f.code);

    test('a complete page has none of the new audit findings', () => {
      const r = validateDist(buildDist(cleanHead, '<main><img src="/hero.png" alt="Hero image"></main>'));
      expect(codes(r)).not.toContain('title-length');
      expect(codes(r)).not.toContain('img-missing-alt');
      expect(codes(r)).not.toContain('og-title-length');
      expect(codes(r)).not.toContain('og-description-length');
      expect(codes(r)).not.toContain('twitter-card-type');
      expect(codes(r)).not.toContain('og-image-missing');
      expect(codes(r)).not.toContain('og-image-relative');
      expect(codes(r)).not.toContain('robots-meta-missing');
    });

    test('short and missing titles warn', () => {
      const shortTitle = validateDist(buildDist(cleanHead.replace('Valid Test Page With Metadata Set', 'Short')));
      expect(codes(shortTitle)).toContain('title-length');

      const missingTitle = validateDist(buildDist(cleanHead.replace('<title>Valid Test Page With Metadata Set</title>', '')));
      expect(codes(missingTitle)).toContain('title-length');
    });

    test('images without alt attributes error, but decorative empty alt is valid', () => {
      const missingAlt = validateDist(buildDist(cleanHead, '<main><img src="/hero.png"><img src="/logo.png" alt=""></main>'));
      expect(missingAlt.errors.map((e) => e.code)).toContain('img-missing-alt');

      const emptyAlt = validateDist(buildDist(cleanHead, '<main><img src="/decor.png" alt=""></main>'));
      expect(emptyAlt.errors.map((e) => e.code)).not.toContain('img-missing-alt');
    });

    test('Open Graph title and description lengths warn when opted in', () => {
      const head = cleanHead
        .replace('content="Valid Test Page With Metadata Set"', 'content="Tiny"')
        .replace(
          'content="A focused validation fixture with complete social metadata for crawler previews."',
          'content="Too short."',
        );
      const r = validateDist(buildDist(head));
      expect(codes(r)).toContain('og-title-length');
      expect(codes(r)).toContain('og-description-length');
    });

    test('social image and card quality warnings fire when Open Graph is present', () => {
      const wrongCard = validateDist(buildDist(cleanHead.replace('summary_large_image', 'summary')));
      expect(codes(wrongCard)).toContain('twitter-card-type');

      const missingImage = validateDist(buildDist(cleanHead.replace('<meta property="og:image" content="https://example.com/og-image.png">', '')));
      expect(codes(missingImage)).toContain('og-image-missing');

      const relativeImage = validateDist(buildDist(cleanHead.replace('https://example.com/og-image.png', '/og-image.png')));
      expect(codes(relativeImage)).toContain('og-image-relative');
    });

    test('robots meta is an advisory page warning', () => {
      const r = validateDist(buildDist(cleanHead.replace('<meta name="robots" content="index,follow">', '')));
      expect(codes(r)).toContain('robots-meta-missing');
      expect(r.ok).toBe(true);
    });

    test('a robots "none" directive opts the page out of auditing like noindex', () => {
      const r = validateDist(
        buildDist(cleanHead.replace('content="index,follow"', 'content="none"'), '<main><img src="/hero.png"></main>'),
      );
      expect(r.pagesChecked).toBe(0);
      expect(r.errors.map((e) => e.code)).not.toContain('img-missing-alt');
    });

    test('a ">" inside an image attribute value does not cause a false missing-alt error', () => {
      const r = validateDist(buildDist(cleanHead, '<main><img title="1 > 2" alt="Chart" src="/hero.png"></main>'));
      expect(r.errors.map((e) => e.code)).not.toContain('img-missing-alt');
    });
  });
});

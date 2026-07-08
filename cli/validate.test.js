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
  });
});

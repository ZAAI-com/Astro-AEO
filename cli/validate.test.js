import { test, expect, describe } from 'vitest';
import { dirname, join } from 'node:path';
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
});

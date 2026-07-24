import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { emitSitemapAlias } from './sitemap-alias.js';
import { resolveConfig } from '../config.js';

// A byte sequence that is NOT valid UTF-8 (0xFF 0xFE ...), so a happy-path copy
// that round-tripped through a utf8 string would corrupt it. Proves copyFileSync.
const RAW = Buffer.from([0xff, 0xfe, 0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x0a, 0xc0]);

describe('emitSitemapAlias', () => {
  /** @type {string} */
  let dir;
  /** @type {URL} */
  let distDir;
  /** @type {string[]} */
  let warnings;
  /** @type {{ warn: (m: string) => void }} */
  let logger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aeo-sitemap-'));
    distDir = pathToFileURL(dir + '/');
    warnings = [];
    logger = { warn: (m) => warnings.push(m) };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** @param {Partial<import('../index.js').SitemapAliasOptions>} [sitemapAlias] */
  const cfg = (sitemapAlias) => resolveConfig({ sitemapAlias });

  test('disabled: returns false, writes nothing, no warning', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg({ enabled: false }), logger);
    expect(result).toBe(false);
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(warnings).toEqual([]);
  });

  test('happy path: byte-identical copy, returns true, no warning', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg(), logger);
    expect(result).toBe(true);
    expect(warnings).toEqual([]);
    expect(Buffer.compare(readFileSync(join(dir, 'sitemap.xml')), RAW)).toBe(0);
  });

  test('custom source and output filenames: byte-identical copy at custom destination, no warning', () => {
    writeFileSync(join(dir, 'my-sitemap-index.xml'), RAW);
    const result = emitSitemapAlias(
      distDir,
      cfg({ sourceFilename: 'my-sitemap-index.xml', outputFilename: 'sitemap-alias.xml' }),
      logger,
    );
    expect(result).toBe(true);
    expect(warnings).toEqual([]);
    expect(existsSync(join(dir, 'sitemap-alias.xml'))).toBe(true);
    expect(Buffer.compare(readFileSync(join(dir, 'sitemap-alias.xml')), RAW)).toBe(0);
  });

  test('source missing: returns false, warns, writes nothing', () => {
    const result = emitSitemapAlias(distDir, cfg(), logger);
    expect(result).toBe(false);
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(warnings.some((w) => w.includes('could not find'))).toBe(true);
  });

  test('self-copy (source === output): returns false, warns, leaves source intact', () => {
    writeFileSync(join(dir, 'sitemap.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg({ sourceFilename: 'sitemap.xml', outputFilename: 'sitemap.xml' }), logger);
    expect(result).toBe(false);
    expect(warnings.some((w) => w.includes('same file'))).toBe(true);
    expect(Buffer.compare(readFileSync(join(dir, 'sitemap.xml')), RAW)).toBe(0);
  });

  test('output exists but no public file: overwrites our own prior output, no warning', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), RAW);
    writeFileSync(join(dir, 'sitemap.xml'), Buffer.from('stale'));
    const result = emitSitemapAlias(distDir, cfg(), logger);
    expect(result).toBe(true);
    expect(warnings).toEqual([]);
    expect(Buffer.compare(readFileSync(join(dir, 'sitemap.xml')), RAW)).toBe(0);
  });

  test('preserves a hand-authored public/ file instead of overwriting it', () => {
    const pub = join(dir, 'public');
    mkdirSync(pub);
    writeFileSync(join(pub, 'sitemap.xml'), Buffer.from('static'));
    // Astro copies public/ into dist before build:done, so dist also has it.
    writeFileSync(join(dir, 'sitemap.xml'), Buffer.from('static'));
    writeFileSync(join(dir, 'sitemap-index.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg(), logger, pathToFileURL(pub + '/'));
    expect(result).toBe(false);
    expect(warnings.some((w) => w.includes('public/'))).toBe(true);
    expect(readFileSync(join(dir, 'sitemap.xml')).toString()).toBe('static');
  });

  test('escaping sourceFilename: returns false, warns, copies nothing', () => {
    writeFileSync(join(dir, 'secret.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg({ sourceFilename: '../secret.xml' }), logger);
    expect(result).toBe(false);
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(warnings.some((w) => w.includes('bare filenames'))).toBe(true);
  });

  test('escaping outputFilename: returns false, warns, writes nothing outside root', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), RAW);
    const result = emitSitemapAlias(distDir, cfg({ outputFilename: '../evil.xml' }), logger);
    expect(result).toBe(false);
    expect(existsSync(join(dir, '..', 'evil.xml'))).toBe(false);
    expect(warnings.some((w) => w.includes('bare filenames'))).toBe(true);
  });

  test('copy failure (source is a directory): returns false, warns, does not throw', () => {
    mkdirSync(join(dir, 'sitemap-index.xml'));
    const result = emitSitemapAlias(distDir, cfg(), logger);
    expect(result).toBe(false);
    expect(warnings.some((w) => w.includes('copy failed'))).toBe(true);
  });
});

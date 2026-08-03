import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter } from './artifacts.js';

let dir;
let distDir;
let warnings;
let logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aeo-artifacts-'));
  distDir = pathToFileURL(`${dir}/`);
  warnings = [];
  logger = { info: () => {}, warn: (m) => warnings.push(m) };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const artifact = (over = {}) => ({
  path: join(dir, 'llms.txt'),
  owner: 'llmsTxt',
  route: '/llms.txt',
  contents: 'body',
  onConflict: 'overwrite',
  ...over,
});

describe('writing', () => {
  test('writes contents and creates missing directories', () => {
    const writer = createArtifactWriter({ distDir, logger });
    const path = join(dir, '.well-known', 'domain-profile.json');
    expect(writer.write(artifact({ path, owner: 'domainProfile', contents: '{}' }))).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('{}');
    expect(warnings).toEqual([]);
  });

  test('copyFrom produces a byte-identical file', () => {
    const src = join(dir, 'sitemap-index.xml');
    writeFileSync(src, '<urlset/>');
    const writer = createArtifactWriter({ distDir, logger });
    writer.write(artifact({ path: join(dir, 'sitemap.xml'), owner: 'sitemapAlias', copyFrom: src, onConflict: 'skip' }));
    expect(Buffer.compare(readFileSync(src), readFileSync(join(dir, 'sitemap.xml')))).toBe(0);
  });
});

describe('collision policies', () => {
  test("'overwrite' replaces an existing file silently", () => {
    writeFileSync(join(dir, 'llms.txt'), 'old');
    const writer = createArtifactWriter({ distDir, logger });
    expect(writer.write(artifact())).toBe(true);
    expect(readFileSync(join(dir, 'llms.txt'), 'utf8')).toBe('body');
    expect(warnings).toEqual([]);
  });

  test("'warn-overwrite' warns with the owner's own message, then replaces", () => {
    writeFileSync(join(dir, 'robots.txt'), 'old');
    const writer = createArtifactWriter({ distDir, logger });
    const wrote = writer.write(
      artifact({
        path: join(dir, 'robots.txt'),
        owner: 'robotsTxt',
        route: '/robots.txt',
        onConflict: 'warn-overwrite',
        conflictMessage: 'astro-aeo: overwriting an existing robots.txt in the build output',
      }),
    );
    expect(wrote).toBe(true);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toBe('body');
    expect(warnings).toContain('astro-aeo: overwriting an existing robots.txt in the build output');
  });

  test("'skip' leaves the existing file untouched and reports why", () => {
    writeFileSync(join(dir, 'sitemap.xml'), 'user-owned');
    const writer = createArtifactWriter({ distDir, logger });
    const wrote = writer.write(
      artifact({ path: join(dir, 'sitemap.xml'), owner: 'sitemapAlias', onConflict: 'skip', conflictMessage: 'already exists' }),
    );
    expect(wrote).toBe(false);
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe('user-owned');
    expect(warnings).toContain('already exists');
  });
});

describe('collision detection', () => {
  test('two astro-aeo owners claiming one path is reported', () => {
    const writer = createArtifactWriter({ distDir, logger });
    writer.write(artifact());
    writer.write(artifact({ owner: 'urlMap' }));
    expect(warnings.some((w) => w.includes('urlMap and llmsTxt both write /llms.txt'))).toBe(true);
  });

  test('one owner rewriting its own path is not a collision', () => {
    const writer = createArtifactWriter({ distDir, logger });
    writer.write(artifact());
    writer.write(artifact());
    expect(warnings).toEqual([]);
  });

  test('a route the project defines itself is reported', () => {
    // Previously silent: a src/pages/llms.txt.ts endpoint had its output clobbered
    // with no indication that astro-aeo was the one doing it.
    const writer = createArtifactWriter({ distDir, logger, routePaths: new Set(['/llms.txt']) });
    writer.write(artifact());
    expect(warnings.some((w) => w.includes('also produced by a route in this project'))).toBe(true);
  });

  test('route matching is trailing-slash insensitive', () => {
    const writer = createArtifactWriter({ distDir, logger, routePaths: new Set(['/llms.txt/']) });
    writer.write(artifact());
    expect(warnings.some((w) => w.includes('also produced by a route'))).toBe(true);
  });

  test('an unrelated route is not reported', () => {
    const writer = createArtifactWriter({ distDir, logger, routePaths: new Set(['/about']) });
    writer.write(artifact());
    expect(warnings).toEqual([]);
  });

  test('a committed public/ file gets its own wording', () => {
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir);
    writeFileSync(join(publicDir, 'llms.txt'), 'committed');
    const writer = createArtifactWriter({ distDir, logger, publicDir: pathToFileURL(`${publicDir}/`) });
    writer.write(artifact());
    expect(warnings.some((w) => w.includes('also exists in public/'))).toBe(true);
  });
});

describe('reporting', () => {
  test('counts what each owner actually wrote, not what it attempted', () => {
    writeFileSync(join(dir, 'sitemap.xml'), 'user-owned');
    const writer = createArtifactWriter({ distDir, logger });
    writer.write(artifact({ path: join(dir, 'a.md'), owner: 'dotmd', route: '/a.md' }));
    writer.write(artifact({ path: join(dir, 'b.md'), owner: 'dotmd', route: '/b.md' }));
    writer.write(artifact({ path: join(dir, 'sitemap.xml'), owner: 'sitemapAlias', onConflict: 'skip' }));
    expect(writer.count('dotmd')).toBe(2);
    expect(writer.count('sitemapAlias')).toBe(0);
  });

  test('writeAll separates written from skipped', () => {
    writeFileSync(join(dir, 'skipped.txt'), 'existing');
    const writer = createArtifactWriter({ distDir, logger });
    const result = writer.writeAll([
      artifact({ path: join(dir, 'written.txt') }),
      artifact({ path: join(dir, 'skipped.txt'), onConflict: 'skip' }),
    ]);
    expect(result.written).toBe(1);
    expect(result.skipped).toHaveLength(1);
  });
});

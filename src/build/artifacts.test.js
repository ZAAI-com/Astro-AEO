import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter } from './artifacts.js';

let dir;
let distDir;
let warnings;
let infos;
let logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aeo-artifacts-'));
  distDir = pathToFileURL(`${dir}/`);
  warnings = [];
  infos = [];
  logger = { info: (m) => infos.push(m), warn: (m) => warnings.push(m) };
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

  test("'skip' does not claim that a retained route or owner was overwritten", () => {
    writeFileSync(join(dir, 'llms.txt'), 'route-owned');
    const writer = createArtifactWriter({
      distDir,
      logger,
      routePaths: new Set(['/llms.txt']),
    });
    writer.write(artifact({ owner: 'dotmd' }));
    warnings = [];

    expect(writer.write(artifact({ onConflict: 'skip', conflictMessage: 'kept existing' }))).toBe(
      false,
    );
    expect(warnings).toEqual([
      'kept existing',
      expect.stringContaining('existing dotmd output was retained'),
      expect.stringContaining('project route output was retained'),
    ]);
    expect(warnings.join('\n')).not.toMatch(/overwrote|later write wins/);
  });

  test("'skip' preserves an on-demand project route without a destination file", () => {
    const path = join(dir, 'sitemap.xml');
    const writer = createArtifactWriter({
      distDir,
      logger,
      routePaths: new Set(['/sitemap.xml']),
    });

    expect(
      writer.write(
        artifact({
          path,
          owner: 'sitemapAlias',
          route: '/sitemap.xml',
          onConflict: 'skip',
          conflictMessage: 'kept project route',
        }),
      ),
    ).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(warnings).toEqual([
      expect.stringContaining('project route output was retained'),
    ]);
    expect(warnings.join('\n')).not.toContain('overwrote');
  });

  test("'skip' identifies a retained public file without claiming an overwrite", () => {
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir);
    writeFileSync(join(publicDir, 'llms.txt'), 'public-owned');
    writeFileSync(join(dir, 'llms.txt'), 'copied-public');
    const writer = createArtifactWriter({
      distDir,
      logger,
      publicDir: pathToFileURL(`${publicDir}/`),
    });

    expect(writer.write(artifact({ onConflict: 'skip', conflictMessage: 'kept existing' }))).toBe(
      false,
    );
    expect(warnings).toEqual([
      'kept existing',
      expect.stringContaining('copied public file was retained'),
    ]);
    expect(warnings.join('\n')).not.toContain('overwrote');
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

  test('an on-demand dynamic route collides without a destination file', () => {
    const path = join(dir, 'sitemap.xml');
    const writer = createArtifactWriter({
      distDir,
      logger,
      routeMatchers: [{ pattern: /^\/[^/]+\.xml\/?$/, prerendered: false }],
    });

    expect(
      writer.write(
        artifact({
          path,
          owner: 'sitemapAlias',
          route: '/sitemap.xml',
          onConflict: 'skip',
        }),
      ),
    ).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(warnings).toEqual([expect.stringContaining('project route output was retained')]);
  });

  test('a prerendered dynamic route collides only when it emitted the destination', () => {
    const matcher = { pattern: /^\/[^/]+\.txt\/?$/, prerendered: true };
    const absentPath = join(dir, 'absent.txt');
    const absentWriter = createArtifactWriter({ distDir, logger, routeMatchers: [matcher] });
    expect(
      absentWriter.write(artifact({ path: absentPath, route: '/absent.txt' })),
    ).toBe(true);
    expect(warnings).toEqual([]);

    warnings = [];
    const generatedPath = join(dir, 'generated.txt');
    writeFileSync(generatedPath, 'project route');
    const generatedWriter = createArtifactWriter({ distDir, logger, routeMatchers: [matcher] });
    expect(
      generatedWriter.write(artifact({ path: generatedPath, route: '/generated.txt' })),
    ).toBe(true);
    expect(warnings).toEqual([
      expect.stringContaining('also produced by a route in this project'),
    ]);
  });

  test('does not mistake an earlier artifact for a prerendered route destination', () => {
    const path = join(dir, 'generated.txt');
    const writer = createArtifactWriter({
      distDir,
      logger,
      routeMatchers: [{ pattern: /^\/[^/]+\.txt$/, prerendered: true }],
    });

    writer.write(artifact({ path, route: '/generated.txt', owner: 'llmsTxt' }));
    writer.write(artifact({ path, route: '/generated.txt', owner: 'urlMap' }));

    expect(warnings).toEqual([
      expect.stringContaining('urlMap and llmsTxt both write /generated.txt'),
    ]);
    expect(warnings.join('\n')).not.toContain('route in this project');
  });

  test('stateful dynamic route patterns are reset for every collision check', () => {
    const pattern = /^\/[^/]+\.txt\/?$/g;
    pattern.lastIndex = 99;
    const writer = createArtifactWriter({
      distDir,
      logger,
      routeMatchers: [{ pattern, prerendered: false }],
    });

    writer.write(artifact({ path: join(dir, 'first.txt'), route: '/first.txt' }));
    writer.write(artifact({ path: join(dir, 'second.txt'), route: '/second.txt' }));

    expect(warnings).toHaveLength(2);
    expect(pattern.lastIndex).toBe(0);
  });

  test('matches Astro 6 dynamic endpoint patterns that retain a trailing slash', () => {
    const writer = createArtifactWriter({
      distDir,
      logger,
      routeMatchers: [{ pattern: /^\/[^/]+\.md\/$/, prerendered: false }],
    });

    writer.write(artifact({ path: join(dir, 'about.md'), route: '/about.md' }));

    expect(warnings).toEqual([
      expect.stringContaining('/about.md is also produced by a route in this project'),
    ]);
  });

  test('a committed public/ file gets its own wording', () => {
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir);
    writeFileSync(join(publicDir, 'llms.txt'), 'committed');
    const writer = createArtifactWriter({ distDir, logger, publicDir: pathToFileURL(`${publicDir}/`) });
    writer.write(artifact());
    expect(warnings.some((w) => w.includes('also exists in public/'))).toBe(true);
  });

  test('an artifact written directly inside public/ is detected without a route hint', () => {
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir);
    const path = join(publicDir, 'Url-Map.md');
    writeFileSync(path, 'committed');
    const writer = createArtifactWriter({
      distDir,
      logger,
      publicDir: pathToFileURL(`${publicDir}/`),
    });
    writer.write(artifact({ path, owner: 'urlMap', route: undefined }));
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

  test('reports successful ownership counts once all phases are complete', () => {
    const writer = createArtifactWriter({ distDir, logger });
    writer.write(artifact({ path: join(dir, 'a.md'), owner: 'dotmd' }));
    writer.write(artifact({ path: join(dir, 'b.md'), owner: 'dotmd' }));
    writer.write(artifact({ owner: 'llmsTxt' }));

    expect(writer.report()).toEqual({
      total: 3,
      byOwner: { dotmd: 2, llmsTxt: 1 },
    });
    expect(infos).toEqual([
      'astro-aeo: artifact registry wrote 3 artifact(s): dotmd=2, llmsTxt=1',
    ]);
  });
});

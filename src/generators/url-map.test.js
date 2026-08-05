import { test, expect, describe, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter } from '../build/artifacts.js';
import { resolveConfig } from '../config.js';
import { emitUrlMap, resolveWithinRoot } from './url-map.js';

describe('resolveWithinRoot', () => {
  const ROOT = '/home/user/proj';

  test('resolves an in-root path', () => {
    expect(resolveWithinRoot(ROOT, 'docs/Url-Map.md')).toBe(resolve(ROOT, 'docs/Url-Map.md'));
  });

  test('allows the project root itself', () => {
    expect(resolveWithinRoot(ROOT, '.')).toBe(resolve(ROOT));
  });

  test('rejects a parent-directory escape', () => {
    expect(() => resolveWithinRoot(ROOT, '../secrets/x.md')).toThrow(/escapes the project root/);
  });

  test('rejects a sibling sharing the root name prefix', () => {
    expect(() => resolveWithinRoot(ROOT, '../proj-secrets/x.md')).toThrow(/escapes the project root/);
  });
});

describe('emitUrlMap', () => {
  test('writes through the shared registry and preserves overwrite behaviour', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'aeo-url-map-'));
    const warnings = [];
    const writer = createArtifactWriter({
      distDir: pathToFileURL(`${join(projectRoot, 'dist')}/`),
      logger: { info: () => {}, warn: (message) => warnings.push(message) },
    });
    const output = join(projectRoot, 'docs', 'Url-Map.md');
    try {
      // Simulate an earlier phase claiming the configured URL-map path. The
      // historical overwrite still wins, while the shared registry names it.
      writer.write({
        path: output,
        owner: 'dotmd',
        contents: 'earlier',
        onConflict: 'overwrite',
      });
      const config = resolveConfig({ urlMap: { enabled: true } });

      expect(
        emitUrlMap(
          [
            {
              pathname: '/about',
              mdHref: '/about.md',
              title: 'About | Example',
              lastModified: '2026-08-05T12:00:00.000Z',
            },
          ],
          config,
          projectRoot,
          new Date('2026-08-05T12:34:56.000Z'),
          writer,
        ),
      ).toBe(true);

      expect(readFileSync(output, 'utf8')).toContain(
        '| /about | /about.md | About \\| Example | 2026-08-05 |',
      );
      expect(writer.count('urlMap')).toBe(1);
      expect(warnings.some((warning) => warning.includes('urlMap and dotmd both write'))).toBe(
        true,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('validates root confinement before invoking the registry', () => {
    const writer = { write: vi.fn() };
    const config = resolveConfig({
      urlMap: { enabled: true, outputFilepath: '../outside.md' },
    });

    expect(() =>
      emitUrlMap([], config, '/home/user/proj', new Date('2026-08-05T00:00:00Z'), writer),
    ).toThrow(/escapes the project root/);
    expect(writer.write).not.toHaveBeenCalled();
  });

  test('reports a configured output that overwrites a committed public file', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'aeo-url-map-public-'));
    const publicDir = join(projectRoot, 'public');
    const output = join(publicDir, 'Url-Map.md');
    const warnings = [];
    mkdirSync(publicDir);
    writeFileSync(output, 'committed');
    const writer = createArtifactWriter({
      distDir: pathToFileURL(`${join(projectRoot, 'dist')}/`),
      publicDir: pathToFileURL(`${publicDir}/`),
      logger: { info: () => {}, warn: (message) => warnings.push(message) },
    });
    const config = resolveConfig({
      urlMap: { enabled: true, outputFilepath: 'public/Url-Map.md' },
    });

    try {
      expect(
        emitUrlMap([], config, projectRoot, new Date('2026-08-05T12:34:56.000Z'), writer),
      ).toBe(true);
      expect(readFileSync(output, 'utf8')).toContain('# Url Map');
      expect(warnings.some((warning) => warning.includes('also exists in public/'))).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

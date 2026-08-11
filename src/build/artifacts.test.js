import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter, normalizeArtifactPathname } from './artifacts.js';

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

describe('exact served pathname normalization', () => {
  test.each([
    ['/schema/graph.jsonld', { key: '/schema/graph.jsonld', pathname: '/schema/graph.jsonld' }],
    ['/caf%C3%A9.json', { key: '/café.json', pathname: '/caf%C3%A9.json' }],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeArtifactPathname(input)).toEqual(expected);
  });

  test.each([
    '',
    'relative.txt',
    '/',
    '//example.test/file',
    '/a//b',
    '/a/../b',
    '/a/%2e%2e/b',
    '/a/%252e%252e/b',
    '/a%2fb',
    '/a?query',
    '/a#hash',
    '/a/*.txt',
    '/a/[x].txt',
    '/a\\b',
    '/docs/item/',
    '/%61.txt',
    '/café.json',
    '/caf%c3%a9.json',
    '/literal%2520escape.txt',
  ])('rejects non-exact or unsafe pathname %s', (input) => {
    expect(normalizeArtifactPathname(input)).toBeNull();
  });
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

describe('deferred ownership and transaction', () => {
  /** @param {Record<string, any>} [options] */
  function deferredWriter(options = {}) {
    return createArtifactWriter({
      distDir,
      logger,
      deferred: true,
      projectRoot: dir,
      diagnostics: [],
      failOn: 'error',
      ...options,
    });
  }

  test('does not touch destinations before commit and writes an ownership manifest', () => {
    const writer = deferredWriter();
    const path = join(dir, 'llms.txt');
    expect(writer.write(artifact({ path }))).toBe(true);
    expect(existsSync(path)).toBe(false);

    expect(writer.commit()).toEqual({ total: 1, byOwner: { llmsTxt: 1 } });
    expect(readFileSync(path, 'utf8')).toBe('body');
    const manifest = JSON.parse(
      readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      version: 1,
      base: '/',
      artifacts: [
        {
          pathname: '/llms.txt',
          status: 'emitted',
          owner: { kind: 'core', name: 'llmsTxt' },
          outputPath: 'llms.txt',
          representation: { contentType: 'text/plain; charset=utf-8' },
        },
      ],
    });
    expect(manifest.artifacts[0].representation.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  test('reserves exact runtime ownership and transactionally removes an authorized public copy', () => {
    const publicRoot = join(dir, 'public');
    mkdirSync(publicRoot);
    writeFileSync(join(publicRoot, 'llms.txt'), 'public source');
    writeFileSync(join(dir, 'llms.txt'), 'copied public source');
    const writer = deferredWriter({
      publicDir: pathToFileURL(`${publicRoot}/`),
      replacePaths: ['/llms.txt'],
    });
    writer.write({
      route: '/llms.txt',
      owner: { kind: 'core', name: 'llmsTxt' },
      runtime: true,
    });

    expect(readFileSync(join(dir, 'llms.txt'), 'utf8')).toBe('copied public source');
    expect(writer.commit()).toEqual({ total: 0, byOwner: {} });
    expect(existsSync(join(dir, 'llms.txt'))).toBe(false);
    expect(readFileSync(join(publicRoot, 'llms.txt'), 'utf8')).toBe('public source');
    const manifest = JSON.parse(
      readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest.artifacts).toEqual([
      expect.objectContaining({
        pathname: '/llms.txt',
        status: 'runtime',
        replacedOwners: [{ kind: 'public-file' }],
      }),
    ]);
  });

  test('keeps a runtime schema pair all-or-none when one public member blocks it', () => {
    const publicRoot = join(dir, 'public');
    mkdirSync(join(publicRoot, 'schema'), { recursive: true });
    mkdirSync(join(dir, 'schema'), { recursive: true });
    writeFileSync(join(publicRoot, 'schema', 'graph.jsonld'), 'public graph');
    writeFileSync(join(dir, 'schema', 'graph.jsonld'), 'copied public graph');
    const writer = deferredWriter({
      publicDir: pathToFileURL(`${publicRoot}/`),
      failOn: 'off',
    });
    for (const [name, owner] of [['graph.jsonld', 'schemaGraph'], ['schema-map.xml', 'schemaMap']]) {
      writer.write({
        route: `/schema/${name}`,
        owner: { kind: 'core', name: owner },
        runtime: true,
        group: 'astro-aeo/schema-corpus',
      });
    }

    writer.commit();
    expect(readFileSync(join(dir, 'schema', 'graph.jsonld'), 'utf8')).toBe('copied public graph');
    const manifest = JSON.parse(
      readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest.groups).toEqual([
      expect.objectContaining({ id: 'astro-aeo/schema-corpus', status: 'skipped' }),
    ]);
    expect(manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: '/schema/graph.jsonld', status: 'preserved' }),
      expect.objectContaining({ pathname: '/schema/schema-map.xml', status: 'group-skipped' }),
    ]));
  });

  test('snapshots byte-copy candidates before validation and commit', () => {
    const source = join(dir, 'source.xml');
    const destination = join(dir, 'sitemap.xml');
    writeFileSync(source, Buffer.from([0, 1, 2, 255]));
    const writer = deferredWriter();
    writer.write(artifact({
      path: destination,
      route: '/sitemap.xml',
      owner: 'sitemapAlias',
      contents: undefined,
      copyFrom: source,
    }));
    writeFileSync(source, 'changed');

    writer.commit();
    expect([...readFileSync(destination)]).toEqual([0, 1, 2, 255]);
  });

  test('project and public owners win unless the exact served path is authorized', () => {
    const publicRoot = join(dir, 'public');
    mkdirSync(join(publicRoot, 'docs'), { recursive: true });
    writeFileSync(join(publicRoot, 'docs', 'public.txt'), 'public source');
    const projectPath = join(dir, 'docs', 'project.txt');
    const publicPath = join(dir, 'docs', 'public.txt');
    const writer = deferredWriter({
      base: '/docs',
      routePaths: new Set(['/project.txt']),
      publicDir: pathToFileURL(`${publicRoot}/`),
      replacePaths: ['/docs/project.txt'],
    });
    writer.write(artifact({ path: join(dir, 'project.txt'), route: '/project.txt', contents: 'generated project' }));
    writer.write(artifact({ path: join(dir, 'public.txt'), route: '/public.txt', contents: 'generated public' }));

    writer.commit();
    expect(readFileSync(projectPath, 'utf8')).toBe('generated project');
    expect(existsSync(publicPath)).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathname: '/docs/project.txt',
        status: 'emitted',
        replacedOwners: [expect.objectContaining({ kind: 'project-route' })],
      }),
      expect.objectContaining({
        pathname: '/docs/public.txt',
        status: 'preserved',
        blockingOwners: [{ kind: 'public-file' }],
      }),
    ]));
  });

  test('derives plugin destinations only from validated served pathnames', () => {
    const outside = join(dirname(dir), `${basename(dir)}-plugin-escape.txt`);
    const writer = deferredWriter();
    writer.write({
      pathname: '/plugins/safe.txt',
      path: outside,
      owner: { kind: 'plugin', name: 'fixture' },
      representation: { body: 'safe', contentType: 'text/plain; charset=utf-8' },
    });

    writer.commit();
    expect(readFileSync(join(dir, 'plugins', 'safe.txt'), 'utf8')).toBe('safe');
    expect(existsSync(outside)).toBe(false);
  });

  test('rejects a served destination beneath a symlinked output directory', () => {
    const outside = join(dirname(dir), `${basename(dir)}-plugin-target`);
    mkdirSync(outside);
    symlinkSync(outside, join(dir, 'linked'), 'dir');
    try {
      const diagnostics = [];
      const writer = deferredWriter({ diagnostics, failOn: 'off' });

      expect(writer.write({
        pathname: '/linked/escape.txt',
        owner: { kind: 'plugin', name: 'fixture' },
        representation: { body: 'unsafe', contentType: 'text/plain' },
      })).toBe(false);
      expect(() => writer.commit()).toThrow(/artifact validation failed/);

      expect(existsSync(join(outside, 'escape.txt'))).toBe(false);
      expect(diagnostics).toEqual([
        expect.objectContaining({ code: 'artifact-invalid-destination', severity: 'error' }),
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('lets a plugin replace an external owner only with per-claim authorization', () => {
    const path = join(dir, 'plugin.txt');
    writeFileSync(path, 'project');
    const writer = deferredWriter({ routePaths: new Set(['/plugin.txt']) });
    writer.write({
      pathname: '/plugin.txt',
      owner: { kind: 'plugin', name: 'fixture' },
      replace: true,
      representation: { body: 'plugin', contentType: 'text/plain' },
    });

    writer.commit();
    expect(readFileSync(path, 'utf8')).toBe('plugin');
  });

  test('never replaces a project-root artifact that has no served pathname', () => {
    const path = join(dir, 'docs', 'Url-Map.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'project owned');
    const writer = deferredWriter({ replacePaths: ['/docs/Url-Map.md'] });
    writer.write({ path, owner: 'urlMap', contents: 'generated' });

    writer.commit();
    expect(readFileSync(path, 'utf8')).toBe('project owned');
    expect(warnings).toEqual([
      expect.stringContaining('Choose a different output path'),
    ]);
  });

  test('collects invalid replacement paths and representation headers before failing', () => {
    const diagnostics = [];
    const writer = deferredWriter({ diagnostics, replacePaths: ['/docs/*.txt'] });
    expect(writer.write({
      pathname: '/safe.txt',
      owner: { kind: 'plugin', name: 'fixture' },
      representation: { body: 'safe', contentType: 'text/plain\0unsafe' },
    })).toBe(false);

    expect(() => writer.commit()).toThrow(/2 blocking diagnostic/);
    expect(diagnostics.map((finding) => finding.code)).toEqual([
      'artifact-invalid-replacement-path',
      'artifact-invalid-representation',
    ]);
    expect(existsSync(join(dir, 'safe.txt'))).toBe(false);
  });

  test('duplicate generated claims are order-independent errors and emit neither', () => {
    const diagnostics = [];
    const path = join(dir, 'same.txt');
    const writer = deferredWriter({ diagnostics });
    writer.write(artifact({ path, route: '/same.txt', owner: 'llmsTxt', contents: 'first' }));
    writer.write(artifact({ path, route: '/same.txt', owner: 'urlMap', contents: 'second' }));

    expect(() => writer.commit()).toThrow(/artifact validation failed/);
    expect(existsSync(path)).toBe(false);
    expect(diagnostics.filter((finding) => finding.code === 'artifact-generated-conflict')).toHaveLength(1);
    expect(diagnostics[0].message).toContain('core "llmsTxt", core "urlMap"');
    expect(existsSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'))).toBe(false);
  });

  test('freezes candidate registration once ownership resolution starts', () => {
    const writer = deferredWriter({ failOn: 'off' });
    writer.write(artifact({ path: join(dir, 'first.txt'), route: '/first.txt' }));
    writer.resolve();

    expect(() =>
      writer.write(artifact({ path: join(dir, 'late.txt'), route: '/late.txt' })),
    ).toThrow(/after ownership resolution/);
    expect(() =>
      writer.stageTransform(join(dir, 'index.html'), 'late', (value) => value),
    ).toThrow(/after ownership resolution/);
  });

  test('applies only mandatory redaction when artifact validation fails', () => {
    const html = join(dir, 'index.html');
    const path = join(dir, 'same.txt');
    writeFileSync(html, '<head><script data-astro-aeo-marker>secret</script></head>');
    const writer = deferredWriter();
    writer.stageTransform(html, 'head', (value) => value.replace('</head>', '<meta name="x"></head>'));
    writer.stageRedaction(html, 'marker-redaction', (value) =>
      value.replace(/<script data-astro-aeo-marker>.*?<\/script>/, ''),
    );
    writer.write(artifact({ path, route: '/same.txt', owner: 'llmsTxt' }));
    writer.write(artifact({ path, route: '/same.txt', owner: 'urlMap' }));

    expect(() => writer.commit()).toThrow(/artifact validation failed/);
    expect(readFileSync(html, 'utf8')).toBe('<head></head>');
  });

  test('runs mandatory redactions after ordinary transforms on success', () => {
    const html = join(dir, 'index.html');
    writeFileSync(html, '<head><script data-private>old</script></head>');
    const writer = deferredWriter();
    writer.stageRedaction(html, 'marker-redaction', (value) =>
      value.replace(/<script data-private>.*?<\/script>/g, ''),
    );
    writer.stageTransform(html, 'head', (value) =>
      value.replace('</head>', '<script data-private>new</script><meta name="x"></head>'),
    );

    writer.commit();
    expect(readFileSync(html, 'utf8')).toBe('<head><meta name="x"></head>');
  });

  test('applies the validation threshold only to the configured build scope', () => {
    const preexisting = [{
      version: 1,
      code: 'page-finding',
      severity: 'error',
      message: 'page finding',
    }];
    const artifactsOnly = deferredWriter({ diagnostics: [...preexisting] });
    artifactsOnly.write(artifact({ path: join(dir, 'artifacts-only.txt'), route: '/artifacts-only.txt' }));
    expect(() => artifactsOnly.commit()).not.toThrow();

    const recommended = deferredWriter({
      projectRoot: join(dir, 'recommended-cache'),
      diagnostics: [...preexisting],
      validationOnBuild: 'recommended',
    });
    recommended.write(artifact({ path: join(dir, 'recommended.txt'), route: '/recommended.txt' }));
    expect(() => recommended.commit()).toThrow(/artifact validation failed/);
    expect(existsSync(join(dir, 'recommended.txt'))).toBe(false);
  });

  test('keeps structural ownership conflicts mandatory when build validation is off', () => {
    const diagnostics = [];
    const path = join(dir, 'disabled.txt');
    const writer = deferredWriter({ diagnostics, validationOnBuild: 'off' });
    writer.write(artifact({ path, route: '/disabled.txt', owner: 'llmsTxt' }));
    writer.write(artifact({ path, route: '/disabled.txt', owner: 'urlMap' }));

    expect(() => writer.commit()).toThrow(/artifact validation failed/);
    expect(existsSync(path)).toBe(false);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'artifact-generated-conflict', severity: 'error' }),
    ]);
  });

  test('keeps build-complete plugin isolation mandatory when build validation is off', () => {
    const diagnostics = [];
    const path = join(dir, 'pending.txt');
    const writer = deferredWriter({ diagnostics, validationOnBuild: 'off' });
    writer.write(artifact({ path, route: '/pending.txt' }));
    diagnostics.push({
      version: 1,
      code: 'plugin-build-complete-isolated',
      severity: 'error',
      message: 'pending commit isolated',
    });

    expect(() => writer.commit()).toThrow(/artifact validation failed/);
    expect(existsSync(path)).toBe(false);
  });

  test('an all-or-none group suppresses its free member when its peer is blocked', () => {
    const blocked = join(dir, 'schema', 'graph.jsonld');
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, 'project graph');
    const map = join(dir, 'schema', 'schema-map.xml');
    const writer = deferredWriter({ failOn: 'off' });
    writer.write(artifact({
      path: blocked,
      route: '/schema/graph.jsonld',
      owner: 'schemaGraph',
      group: 'astro-aeo/schema-corpus',
      contents: '{}',
    }));
    writer.write(artifact({
      path: map,
      route: '/schema/schema-map.xml',
      owner: 'schemaMap',
      group: 'astro-aeo/schema-corpus',
      contents: '<map/>',
    }));

    writer.commit();
    expect(readFileSync(blocked, 'utf8')).toBe('project graph');
    expect(existsSync(map)).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest.groups).toEqual([
      expect.objectContaining({ id: 'astro-aeo/schema-corpus', status: 'skipped' }),
    ]);
    expect(manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: '/schema/graph.jsonld', status: 'preserved' }),
      expect.objectContaining({ pathname: '/schema/schema-map.xml', status: 'group-skipped' }),
    ]));
  });

  test('refreshes and cleans only hash-matching outputs from the prior manifest', () => {
    const first = deferredWriter();
    first.write(artifact({ path: join(dir, 'old.txt'), route: '/old.txt', contents: 'old' }));
    first.write(artifact({ path: join(dir, 'keep.txt'), route: '/keep.txt', contents: 'first' }));
    first.commit();

    const second = deferredWriter();
    second.write(artifact({ path: join(dir, 'keep.txt'), route: '/keep.txt', contents: 'second' }));
    second.commit();
    expect(existsSync(join(dir, 'old.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('second');

    writeFileSync(join(dir, 'keep.txt'), 'user modified');
    const third = deferredWriter({ failOn: 'off' });
    third.write(artifact({ path: join(dir, 'keep.txt'), route: '/keep.txt', contents: 'third' }));
    third.commit();
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('user modified');
  });

  test('cleans a prior atomic group only when every stale member is unchanged', () => {
    const first = deferredWriter();
    for (const name of ['graph.jsonld', 'schema-map.xml']) {
      first.write(artifact({
        path: join(dir, 'schema', name),
        route: `/schema/${name}`,
        owner: name === 'graph.jsonld' ? 'schemaGraph' : 'schemaMap',
        group: 'schema-corpus',
        contents: name,
      }));
    }
    first.commit();
    writeFileSync(join(dir, 'schema', 'graph.jsonld'), 'user modified');

    deferredWriter().commit();
    expect(readFileSync(join(dir, 'schema', 'graph.jsonld'), 'utf8')).toBe('user modified');
    expect(readFileSync(join(dir, 'schema', 'schema-map.xml'), 'utf8')).toBe('schema-map.xml');
  });

  test('does not trust a prior manifest path that escapes the output root', () => {
    const outside = join(dirname(dir), `${basename(dir)}-ownership-victim.txt`);
    writeFileSync(outside, 'victim');
    const first = deferredWriter();
    first.write(artifact({ path: join(dir, 'old.txt'), route: '/old.txt', contents: 'old' }));
    first.commit();
    const manifestPath = join(dir, '.astro', 'aeo-cache', 'ownership-v1.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[0].outputPath = '../ownership-victim.txt';
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    deferredWriter().commit();
    expect(readFileSync(outside, 'utf8')).toBe('victim');
    rmSync(outside);
  });

  test('rolls back destinations and retains the last successful manifest on commit failure', () => {
    const initial = deferredWriter();
    initial.write(artifact({ path: join(dir, 'a.txt'), route: '/a.txt', contents: 'old a' }));
    initial.commit();
    const oldManifest = readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8');

    const diagnostics = [];
    const html = join(dir, 'index.html');
    writeFileSync(html, '<head><script data-astro-aeo-marker>secret</script></head>');
    const failing = deferredWriter({
      diagnostics,
      beforeApply(_operation, index) {
        if (index === 1) throw new Error('injected commit failure');
      },
    });
    failing.write(artifact({ path: join(dir, 'a.txt'), route: '/a.txt', contents: 'new a' }));
    failing.write(artifact({ path: join(dir, 'b.txt'), route: '/b.txt', contents: 'new b' }));
    failing.stageTransform(html, 'head', (value) =>
      value.replace('</head>', '<meta name="enrichment"></head>'),
    );
    failing.stageRedaction(html, 'marker-redaction', (value) =>
      value.replace(/<script data-astro-aeo-marker>.*?<\/script>/, ''),
    );

    expect(() => failing.commit()).toThrow(/injected commit failure/);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('old a');
    expect(existsSync(join(dir, 'b.txt'))).toBe(false);
    expect(readFileSync(join(dir, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8')).toBe(oldManifest);
    expect(readFileSync(html, 'utf8')).toBe('<head></head>');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'artifact-commit-failed', severity: 'error' }),
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain('injected commit failure');
  });
});

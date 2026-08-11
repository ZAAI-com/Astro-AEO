import { afterEach, describe, expect, test } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from '../config.js';
import { createPluginDispatcher } from '../plugins/dispatcher.js';
import { createSemanticPlugin } from '../semantic/plugin.js';
import { onBuildDone } from './build-done.js';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(html) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-build-pipeline-'));
  roots.push(root);
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), html);
  return { root, dist, dir: pathToFileURL(`${dist}/`) };
}

function config(overrides = {}) {
  return resolveConfig({
    markdown: { enabled: false, alternateLink: 'never' },
    corpus: { index: { enabled: false }, full: { enabled: false } },
    ...overrides,
  });
}

function environment(root, dispatcher, diagnostics = []) {
  return {
    siteUrl: 'https://example.test',
    base: '',
    trailingSlash: 'never',
    buildFormat: 'directory',
    projectRoot: root,
    routeEntrypoints: new Map(),
    resolvedRoutePaths: new Set(['/']),
    resolvedRouteMatchers: [],
    diagnostics,
    runtimeCorpora: false,
    catalogModules: [],
    markdownRenderers: [],
    pluginDispatcher: dispatcher,
  };
}

const logger = { info() {}, warn() {} };

describe('staged build plugin pipeline', () => {
  test('accepts page replacements when Astro has no configured site', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const resolved = config();
    let transformed = false;
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'site-less-transform',
        apiVersion: 1,
        setup(api) {
          api.on('page:transform', ({ value }) => {
            transformed = true;
            return {
              action: 'replace',
              value: {
                ...value,
                title: 'Site-less replacement',
                metadata: { ...value.metadata, title: 'Site-less replacement' },
              },
            };
          });
        },
      }],
    });
    const env = environment(files.root, dispatcher);
    env.siteUrl = '';

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      env,
    );
    writer.commit();

    expect(transformed).toBe(true);
    expect(env.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'plugin-invalid-replacement',
    }));
  });

  test('reserves adapter runtime corpora and removes an exactly replaced public copy', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const publicRoot = join(files.root, 'public');
    mkdirSync(publicRoot);
    writeFileSync(join(publicRoot, 'llms.txt'), 'public corpus');
    writeFileSync(join(files.dist, 'llms.txt'), 'copied public corpus');
    const resolved = config({
      artifacts: { replace: ['/llms.txt'] },
      corpus: { index: { enabled: true }, full: { enabled: false } },
    });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
    });
    const env = environment(files.root, dispatcher);
    env.runtimeCorpora = true;
    env.publicDir = pathToFileURL(`${publicRoot}/`);

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      env,
    );
    writer.commit();

    expect(existsSync(join(files.dist, 'llms.txt'))).toBe(false);
    expect(readFileSync(join(publicRoot, 'llms.txt'), 'utf8')).toBe('public corpus');
    const manifest = JSON.parse(
      readFileSync(join(files.root, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'),
    );
    expect(manifest.artifacts).toContainEqual(expect.objectContaining({
      pathname: '/llms.txt',
      status: 'runtime',
      replacedOwners: [{ kind: 'public-file' }],
    }));
  });

  test('infers build breadcrumbs from complete authored catalog ancestry', async () => {
    const pageHtml = (title) =>
      `<!doctype html><html><head><title>${title}</title></head><body><main>${title}</main></body></html>`;
    const files = fixture(pageHtml('Home'));
    mkdirSync(join(files.dist, 'guides', 'install'), { recursive: true });
    writeFileSync(join(files.dist, 'guides', 'index.html'), pageHtml('Guides'));
    writeFileSync(join(files.dist, 'guides', 'install', 'index.html'), pageHtml('Install'));
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
    });
    const env = environment(files.root, dispatcher);
    env.resolvedRoutePaths = new Set(['/', '/guides', '/guides/install']);
    env.catalogModules = [{
      module: './catalog.js',
      specifier: 'file:///catalog.js',
      namespace: {
        listPages: () => [
          { pathname: '/', title: 'Catalog home' },
          { pathname: '/guides', title: 'Catalog guides' },
          { pathname: '/guides/install', title: 'Catalog install' },
        ],
      },
    }];

    const writer = await onBuildDone(
      resolved,
      {
        dir: files.dir,
        pages: [{ pathname: '/' }, { pathname: '/guides' }, { pathname: '/guides/install' }],
        logger,
      },
      env,
    );
    writer.commit();

    const output = readFileSync(join(files.dist, 'guides', 'install', 'index.html'), 'utf8');
    expect(output).toContain('BreadcrumbList');
    expect(output).toContain('"name":"Catalog home"');
    expect(output).toContain('"name":"Catalog guides"');
    expect(output).toContain('"name":"Catalog install"');
  });

  test('runs all stages in order and commits validated replacements atomically', async () => {
    const marker = '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{"description":"Explicit description"}</script>';
    const files = fixture(`<!doctype html><html><head><title>Original</title>${marker}</head><body><main>Body</main></body></html>`);
    const stages = [];
    const frozen = [];
    const pluginPath = join(files.dist, 'plugin.txt');
    const resolved = config();
    const plugin = {
      name: 'pipeline-test',
      apiVersion: 1,
      setup(api) {
        api.claimArtifact({ id: 'plugin-output', pathname: '/plugin.txt' });
        api.on('page:discovered', ({ value }) => {
          stages.push('page:discovered');
          frozen.push(Object.isFrozen(value));
        });
        api.on('page:extract', ({ value }) => {
          stages.push('page:extract');
          frozen.push(Object.isFrozen(value), Object.isFrozen(value.representations));
          return {
            action: 'replace',
            value: {
              ...value,
              representations: { ...value.representations, markdown: '# Hooked' },
              source: { kind: 'custom', path: '/virtual/source' },
            },
          };
        });
        api.on('page:transform', ({ value }) => {
          stages.push('page:transform');
          frozen.push(Object.isFrozen(value));
          expect(value.source).toEqual({ kind: 'custom', path: '/virtual/source' });
          expect(value.markdown).toBe('# Hooked');
        });
        api.on('page:metadata', ({ value }) => {
          stages.push('page:metadata');
          return { action: 'replace', value: { ...value, title: 'Hooked title' } };
        });
        api.on('graph:build', ({ value }) => {
          stages.push('graph:build');
          expect(value.html).toContain('data-astro-aeo-graph');
          expect(value.page.metadata.title).toBe('Hooked title');
        });
        api.on('artifact:generate', ({ value }) => {
          stages.push('artifact:generate');
          return {
            action: 'replace',
            value: {
              ...value,
              representation: { body: 'generated', contentType: 'text/plain; charset=utf-8' },
            },
          };
        });
        api.on('artifact:validate', ({ value }) => {
          stages.push('artifact:validate');
          return {
            action: 'replace',
            value: {
              ...value,
              representation: { ...value.representation, body: `${value.representation.body}:validated` },
            },
          };
        });
        api.on('build:complete', () => {
          stages.push('build:complete');
          expect(existsSync(pluginPath)).toBe(false);
        });
      },
    };
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [plugin],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    expect(stages).toEqual([
      'page:discovered',
      'page:extract',
      'page:transform',
      'page:metadata',
      'graph:build',
      'artifact:generate',
      'artifact:validate',
      'build:complete',
    ]);
    expect(frozen.every(Boolean)).toBe(true);
    expect(existsSync(pluginPath)).toBe(false);

    const lateHtml = readFileSync(join(files.dist, 'index.html'), 'utf8')
      .replace('</head>', '<meta name="later-integration" content="preserved"></head>');
    writeFileSync(join(files.dist, 'index.html'), lateHtml);
    writer.commit();
    expect(readFileSync(pluginPath, 'utf8')).toBe('generated:validated');
    const html = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(html).not.toContain('data-astro-aeo-head');
    expect(html).toContain('data-astro-aeo-graph');
    expect(html).toContain('Hooked title');
    expect(html).toContain('name="later-integration" content="preserved"');
  });

  test('does not reapply a pure insertion at an ambiguous first anchor', async () => {
    const anchor = `<section data-repeat>${'a'.repeat(100)}</section>`;
    const inserted = '<span data-user-insertion></span>';
    const files = fixture(
      `<!doctype html><html><head><title>Repeated</title></head><body>${anchor}${anchor}</body></html>`,
    );
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'insert-at-second-anchor',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => {
            const at = value.html.lastIndexOf(anchor);
            return {
              action: 'replace',
              value: {
                ...value,
                html: `${value.html.slice(0, at)}${inserted}${value.html.slice(at)}`,
              },
            };
          });
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    writer.commit();

    const html = readFileSync(join(files.dist, 'index.html'), 'utf8');
    const firstAnchor = html.indexOf(anchor);
    const insertion = html.indexOf(inserted);
    const secondAnchor = html.lastIndexOf(anchor);
    expect(firstAnchor).toBeGreaterThan(-1);
    expect(insertion).toBe(firstAnchor + anchor.length);
    expect(insertion).toBeLessThan(secondAnchor);
  });

  test('a build-complete isolation aborts enrichment even when validation is off', async () => {
    const marker = '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{}</script>';
    const original = `<!doctype html><html><head><title>Original</title>${marker}</head><body><main>Body</main></body></html>`;
    const files = fixture(original);
    const diagnostics = [];
    const resolved = config({ validation: { onBuild: 'off' } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'stop-commit',
        apiVersion: 1,
        setup(api) {
          api.on('build:complete', () => ({ action: 'isolate' }));
        },
      }],
    });
    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );

    expect(() => writer.commit()).toThrow(/artifact validation failed/);
    const html = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(html).not.toContain('data-astro-aeo-head');
    expect(html).not.toContain('data-astro-aeo-graph');
    expect(html).toContain('<title>Original</title>');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'plugin-build-complete-isolated', severity: 'error' }),
    ]));
  });

  test('redacts both private markers when page discovery isolates the descriptor', async () => {
    const sourceMarker = '<script type="application/vnd.astro-aeo+json" data-astro-aeo-marker>{"markdown":"private"}</script>';
    const headMarker = '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{"title":"private"}</script>';
    const files = fixture(`<!doctype html><html><head><title>Original</title>${headMarker}</head><body>${sourceMarker}<main>Body</main></body></html>`);
    const diagnostics = [];
    const resolved = config({ validation: { onBuild: 'off' } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'isolate-discovery', apiVersion: 1,
        setup(api) { api.on('page:discovered', () => ({ action: 'isolate' })); },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );
    writer.commit();

    const html = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(html).not.toContain('data-astro-aeo-marker');
    expect(html).not.toContain('data-astro-aeo-head');
    expect(html).not.toContain('data-astro-aeo-graph');
    expect(html).toContain('<title>Original</title>');
  });

  test('malformed plugin diagnostics isolate a page when build validation is off', async () => {
    const marker = '<script type="application/vnd.astro-aeo-head+json" data-astro-aeo-head>{}</script>';
    const files = fixture(`<!doctype html><html><head><title>Original</title>${marker}</head><body><main>Body</main></body></html>`);
    const diagnostics = [];
    const resolved = config({ validation: { onBuild: 'off' } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'bad-diagnostics', apiVersion: 1,
        setup(api) {
          api.on('page:metadata', () => ({ action: 'keep', diagnostics: [{ code: '', message: 'private' }] }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );
    writer.commit();

    const html = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(html).not.toContain('data-astro-aeo-head');
    expect(html).not.toContain('data-astro-aeo-graph');
    expect(html).toContain('<title>Original</title>');
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'plugin-invalid-diagnostics',
      pathname: '/',
    }));
    expect(JSON.stringify(diagnostics)).not.toContain('private');
  });
});

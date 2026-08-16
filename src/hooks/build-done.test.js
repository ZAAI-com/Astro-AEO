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
import { createGraph } from '../schema.js';
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
  test('recommended validation includes page-local diagnostics at commit time', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const diagnostics = [];
    const env = environment(files.root, undefined, diagnostics);
    env.markdownRenderers = [{
      name: 'diagnostic-renderer',
      module: './diagnostic-renderer.js',
      render: () => ({
        status: 'continue',
        diagnostics: [{
          code: 'renderer-page-error',
          severity: 'error',
          message: 'The renderer could not produce the preferred representation.',
        }],
      }),
    }];
    const writer = await onBuildDone(
      config({ validation: { onBuild: 'recommended', failOn: 'error' } }),
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      env,
    );

    expect(diagnostics).toEqual([]);
    expect(() => writer.commit()).toThrow(
      'astro-aeo: artifact validation failed with 1 blocking diagnostic(s).',
    );
    const manifest = JSON.parse(
      readFileSync(join(files.root, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
    );
    expect(manifest.pages[0].diagnostics).toEqual([
      expect.objectContaining({ code: 'renderer-page-error', severity: 'error' }),
    ]);
  });

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
        api.claimArtifact({ id: 'plugin-output', pathname: '/plugin.txt', replace: true });
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
          expect(value.claim.replace).toBe(true);
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

  test('reconciles managed-only graph replacements without rewriting authored JSON-LD', async () => {
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","@id":"#author","name":"Authored"}</script>';
    const files = fixture(`<!doctype html><html><head><title>Home</title>${authoredScript}</head><body><main>Home</main></body></html>`);
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'managed-replacement',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              graph: createGraph([{
                '@id': 'https://example.test/#replacement',
                '@type': 'Thing',
                name: 'Managed replacement',
              }]),
            },
          }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    writer.commit();

    const output = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(output).toContain(authoredScript);
    expect(output).toContain('data-astro-aeo-graph');
    expect(output).toContain('Managed replacement');
    expect(output.match(/"name":"Authored"/g)).toHaveLength(1);
  });

  test('retains authored normalization for graph hooks when automatic injection is disabled', async () => {
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","@id":"#author","name":"Authored"}</script>';
    const files = fixture(`<!doctype html><html><head><title>Home</title>${authoredScript}</head><body><main>Home</main></body></html>`);
    const resolved = config({ schema: { autoInject: false } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'managed-without-auto-injection',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              graph: createGraph([{
                '@id': 'https://example.test/#managed',
                '@type': 'Thing',
                name: 'Managed opt-in',
              }]),
            },
          }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    writer.commit();

    const output = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(output).toContain(authoredScript);
    expect(output).toContain('Managed opt-in');
    expect(output.match(/"name":"Authored"/g)).toHaveLength(1);
  });

  test('reconciles managed intent against authored JSON-LD added before commit', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'managed-before-late-authored',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              html: value.html.replace('</body>', '<p data-plugin>Preserved plugin edit</p></body>'),
              graph: createGraph([{
                '@id': 'https://example.test/#managed-late',
                '@type': 'Thing',
                name: 'Managed late',
              }]),
            },
          }));
        },
      }],
    });
    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    const htmlPath = join(files.dist, 'index.html');
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@id":"#late-author","@type":"Person","name":"Late authored"}</script>';
    writeFileSync(
      htmlPath,
      readFileSync(htmlPath, 'utf8').replace('</head>', `${authoredScript}<meta name="later" content="preserved"></head>`),
    );

    writer.commit();

    const output = readFileSync(htmlPath, 'utf8');
    expect(output).toContain(authoredScript);
    expect(output).toContain('Managed late');
    expect(output).toContain('data-plugin');
    expect(output).toContain('name="later" content="preserved"');
    expect(output.match(/"name":"Late authored"/g)).toHaveLength(1);
  });

  test('does not turn an HTML-only hook into a graph replacement after late authored JSON-LD', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'html-only',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              html: value.html.replace('</body>', '<p data-plugin>Preserved HTML</p></body>'),
            },
          }));
        },
      }],
    });
    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    const htmlPath = join(files.dist, 'index.html');
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@id":"https://example.test/#webpage","@type":"WebPage","url":"https://example.test/","name":"Home"}</script>';
    writeFileSync(
      htmlPath,
      readFileSync(htmlPath, 'utf8').replace('</head>', `${authoredScript}</head>`),
    );

    writer.commit();

    const output = readFileSync(htmlPath, 'utf8');
    expect(output).toContain(authoredScript);
    expect(output).toContain('<p data-plugin>Preserved HTML</p>');
    expect(output.match(/"@type":"WebPage"/g)).toHaveLength(1);
  });

  test('retains inspect-only authored diagnostics for build graph hooks', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title><script type="application/ld+json">{"@type":"Thing",}</script></head><body><main>Home</main></body></html>');
    const diagnostics = [];
    const resolved = config({ schema: { autoInject: false, corpus: { enabled: false } } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'inspect-authored',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', () => ({ action: 'keep' }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );
    writer.commit();

    expect(diagnostics.filter(({ code }) => code === 'authored-jsonld-malformed'))
      .toHaveLength(1);
    const manifest = JSON.parse(
      readFileSync(join(files.root, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
    );
    expect(manifest.pages[0].diagnostics.filter(({ code }) =>
      code === 'authored-jsonld-malformed')).toHaveLength(1);
  });

  test('fails closed when late semantic facts would stale a static schema corpus', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const diagnostics = [];
    const resolved = config({ schema: { corpus: { enabled: true } } });
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [],
    });
    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );
    const htmlPath = join(files.dist, 'index.html');
    const latePerson = '<script type="application/ld+json">{"@context":"https://schema.org","@id":"#late-person","@type":"Person","name":"Late Person"}</script>';
    writeFileSync(
      htmlPath,
      readFileSync(htmlPath, 'utf8').replace('</head>', `${latePerson}</head>`),
    );

    expect(() => writer.commit()).toThrow(/semantic replacement could not be reconciled safely/);

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema-corpus-late-semantic-change',
        severity: 'error',
        pathname: '/',
      }),
      expect.objectContaining({ code: 'artifact-commit-failed', severity: 'error' }),
    ]));
    expect(existsSync(join(files.dist, 'schema', 'graph.jsonld'))).toBe(false);
    expect(existsSync(join(files.dist, 'schema', 'schema-map.xml'))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(files.root, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
    );
    expect(manifest.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema-corpus-late-semantic-change' }),
      expect.objectContaining({ code: 'artifact-commit-failed' }),
    ]));
  });

  test('derives managed output from a normalized-only graph replacement', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'normalized-replacement',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              normalizedGraph: createGraph([
                ...value.normalizedGraph.entries,
                {
                  '@id': 'https://example.test/#faq',
                  '@type': 'FAQPage',
                  name: 'Managed from normalized',
                },
              ]),
            },
          }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    writer.commit();

    const output = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(output).toContain('data-astro-aeo-graph');
    expect(output).toContain('Managed from normalized');
  });

  test('rebases a normalized-only delta onto authored facts added before commit', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'normalized-delta',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              normalizedGraph: createGraph([
                ...value.normalizedGraph.entries,
                {
                  '@id': 'https://example.test/#faq-late',
                  '@type': 'FAQPage',
                  name: 'Rebased FAQ',
                },
              ]),
            },
          }));
        },
      }],
    });
    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher),
    );
    const htmlPath = join(files.dist, 'index.html');
    const authoredScript = '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@id":"https://example.test/#webpage","@type":"WebPage","url":"https://example.test/","name":"Home"},{"@id":"https://example.test/#late-person","@type":"Person","name":"Late Person"}]}</script>';
    writeFileSync(
      htmlPath,
      readFileSync(htmlPath, 'utf8').replace('</head>', `${authoredScript}</head>`),
    );

    writer.commit();

    const output = readFileSync(htmlPath, 'utf8');
    expect(output).toContain(authoredScript);
    expect(output).toContain('Rebased FAQ');
    expect(output.match(/"@type":"WebPage"/g)).toHaveLength(1);
    expect(output.match(/"name":"Late Person"/g)).toHaveLength(1);
  });

  test('isolates inconsistent dual graph replacements with a sanitized diagnostic', async () => {
    const files = fixture('<!doctype html><html><head><title>Home</title></head><body><main>Home</main></body></html>');
    const diagnostics = [];
    const resolved = config();
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      internalPlugins: [createSemanticPlugin(resolved)],
      plugins: [{
        name: 'inconsistent-graphs',
        apiVersion: 1,
        setup(api) {
          api.on('graph:build', ({ value }) => ({
            action: 'replace',
            value: {
              ...value,
              graph: createGraph([{
                '@id': 'https://example.test/#secret-managed',
                '@type': 'Thing',
                name: 'SECRET MANAGED VALUE',
              }]),
              normalizedGraph: createGraph([{
                '@id': 'https://example.test/#different',
                '@type': 'Thing',
                name: 'SECRET NORMALIZED VALUE',
              }]),
            },
          }));
        },
      }],
    });

    const writer = await onBuildDone(
      resolved,
      { dir: files.dir, pages: [{ pathname: '/' }], logger },
      environment(files.root, dispatcher, diagnostics),
    );
    expect(() => writer.commit()).toThrow(/artifact validation failed/);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'plugin-graph-inconsistent',
      severity: 'error',
      pathname: '/',
    }));
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
    const output = readFileSync(join(files.dist, 'index.html'), 'utf8');
    expect(output).not.toContain('data-astro-aeo-graph');
    expect(output).not.toContain('SECRET');
  });

  test('aborts and reports a sanitized diagnostic for an ambiguous HTML delta', async () => {
    const anchor = `<section data-repeat>${'a'.repeat(100)}</section>`;
    const inserted = '<span data-user-insertion>SECRET PLUGIN HTML</span>';
    const files = fixture(
      `<!doctype html><html><head><title>Repeated</title></head><body>${anchor}${anchor}</body></html>`,
    );
    const diagnostics = [];
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
      environment(files.root, dispatcher, diagnostics),
    );
    const htmlPath = join(files.dist, 'index.html');
    const laterHtml = readFileSync(htmlPath, 'utf8')
      .replace('</head>', '<meta name="later-integration" content="preserved"></head>');
    writeFileSync(htmlPath, laterHtml);

    expect(() => writer.commit()).toThrow(/could not be reapplied safely/);

    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toBe(laterHtml);
    expect(html).not.toContain(inserted);
    expect(html).toContain('name="later-integration" content="preserved"');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'plugin-html-delta-conflict',
        severity: 'error',
        pathname: '/',
      }),
      expect.objectContaining({ code: 'artifact-commit-failed', severity: 'error' }),
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET PLUGIN HTML');
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

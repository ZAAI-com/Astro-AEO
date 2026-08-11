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
});

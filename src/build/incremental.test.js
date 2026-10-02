import { afterEach, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as extraction from '../core/extract/index.js';
import { resolveConfig } from '../config.js';
import { collectPages } from './collect.js';
import { openProcessingCache } from './processing-cache.js';
import { cachedStage, runCachedPluginStage } from './stage-cache.js';
import { createPluginDispatcher } from '../plugins/dispatcher.js';

const roots = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });
function fixture(count = 1) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-incremental-'));
  roots.push(root);
  const pages = Array.from({ length: count }, (_, index) => ({ pathname: `/p${index}` }));
  mkdirSync(join(root, 'dist'));
  for (const page of pages) writeFileSync(join(root, 'dist', `${page.pathname.slice(1)}.html`),
    `<html><head><title>${page.pathname}</title></head><body><main>Body ${page.pathname}</main></body></html>`);
  const { key } = openProcessingCache(root, { enabled: false });
  const values = new Map();
  const cache = { key, get: (key) => values.get(key), put: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))) };
  const collect = (config = resolveConfig(), renderers = []) => collectPages(pages, config, {
    distDir: pathToFileURL(`${root}/dist/`), siteUrl: 'https://example.test', base: '',
    trailingSlash: 'never', buildFormat: 'file', projectRoot: root,
    routeEntrypoints: new Map(), logger: { warn() {} }, cache, renderers,
  });
  return { root, pages, cache, collect };
}

test('10,000 warm pages perform zero extraction or renderer calls; one edit reconverts one', async () => {
  const { root, collect } = fixture(10_000);
  const convert = vi.spyOn(extraction, 'extractMarkdown');
  const render = vi.fn(() => ({ status: 'decline' }));
  const renderers = [{ name: 'declared', module: 'declared-renderer', cache: { pure: true, version: '1' }, render }];
  const cold = await collect(undefined, renderers);
  expect(convert).toHaveBeenCalledTimes(10_000);
  expect(render).toHaveBeenCalledTimes(10_000);
  convert.mockClear(); render.mockClear();
  expect(await collect(undefined, renderers)).toEqual(cold);
  expect(convert).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  writeFileSync(join(root, 'dist', 'p42.html'), '<html><head><title>/p42</title></head><body><main>Edited</main></body></html>');
  const edited = await collect(undefined, renderers);
  expect(convert).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledTimes(1);
  expect(edited[42].markdown).toBe('Edited');
});

test('unsafe renderers retry while unchanged fallback extraction and unrelated HTTP settings stay warm', async () => {
  const { root, collect } = fixture();
  writeFileSync(join(root, 'dist', 'p0.html'), '<html><head><title>Page</title></head><body><main>Body<nav>Remove navigation</nav><footer>Remove footer</footer></main></body></html>');
  const convert = vi.spyOn(extraction, 'extractMarkdown');
  const render = vi.fn(() => ({ status: 'decline' }));
  const cold = await collect(undefined, [{ name: 'unsafe', inline: true, render }]);
  const warm = await collect(resolveConfig({ markdown: { cacheControl: 'private', frontmatter: true } }),
    [{ name: 'unsafe', inline: true, render }]);
  expect(warm).toEqual(cold);
  expect(render).toHaveBeenCalledTimes(2);
  expect(convert).toHaveBeenCalledTimes(1);
  await collect();
  convert.mockClear();
  await collect(resolveConfig({ markdown: { cacheControl: 'public', frontmatter: true } }));
  expect(convert).not.toHaveBeenCalled();
});

test('hook versions invalidate their own stage and unsafe hooks do not disable pure downstream reuse', async () => {
  const { cache } = fixture();
  const transform = vi.fn(({ value }) => ({ action: 'replace', value: { ...value, transformed: true } }));
  const unsafe = vi.fn();
  const dispatcher = (version) => createPluginDispatcher({ command: 'build', plugins: [{
    name: 'stages', apiVersion: 1, setup(api) {
      api.on('page:extract', unsafe);
      api.on('page:transform', transform, { cache: { pure: true, version } });
    },
  }] });
  let plugins = await dispatcher('1');
  for (let index = 0; index < 2; index++) {
    await runCachedPluginStage(plugins, cache, 'page:extract', { markdown: 'Body' }, {});
    await runCachedPluginStage(plugins, cache, 'page:transform', { markdown: 'Body' }, {});
  }
  expect(unsafe).toHaveBeenCalledTimes(2);
  expect(transform).toHaveBeenCalledTimes(1);
  plugins = await dispatcher('2');
  await runCachedPluginStage(plugins, cache, 'page:transform', { markdown: 'Body' }, {});
  expect(transform).toHaveBeenCalledTimes(2);
  const produce = vi.fn(() => 42);
  await cachedStage(cache, 'graph-v1', { infer: () => 1 }, produce, Number.isInteger);
  await cachedStage(cache, 'graph-v1', { infer: () => 1 }, produce, Number.isInteger);
  expect(produce).toHaveBeenCalledTimes(2);
});

import { test, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '../config.js';
import { runtimeConfigProjection } from '../virtual/serialize.js';
import { analyticsMiddlewarePlugin, preloadAnalytics, validateAnalyticsSurface, analyticsSurface, ANALYTICS_MIDDLEWARE_ID } from './analytics.js';
import aeo from '../index.js';
import { cloudflareEdge } from '../edge/cloudflare.js';
const config = (analytics = {}) => resolveConfig({ analytics }).analytics;

test('runtime projection and ordinary middleware registration are identical when absent or disabled', async () => {
  expect(runtimeConfigProjection(resolveConfig({}))).toEqual(runtimeConfigProjection(resolveConfig({ analytics: { enabled: false } })));
  const setups = [];
  for (const analytics of [undefined, { enabled: false }, { enabled: true }]) {
    const middleware = []; const updates = []; const integration = aeo({ analytics, discovery: { sitemap: { mode: 'disabled' } } });
    await integration.hooks['astro:config:setup']({ config: {}, command: 'dev', logger: { warn() {} }, addMiddleware: (value) => middleware.push(value), updateConfig: (value) => updates.push(value) });
    setups.push({ middleware, updates });
  }
  expect(setups[0].middleware).toEqual(setups[1].middleware); expect(setups[0].updates[0].vite.plugins.map((plugin) => plugin.name)).toEqual(setups[1].updates[0].vite.plugins.map((plugin) => plugin.name));
  expect(setups[2].middleware[0].entrypoint).toBe('astro-aeo/middleware');
  expect(setups[2].updates[0].vite.plugins.map((plugin) => plugin.name)).toContain('astro-aeo:analytics-middleware');
});
test('surface mapping is explicit; JSONL never reaches unknown, Deno or edge runtime', () => {
  expect(analyticsSurface('@astrojs/node', 'build')).toBe('node'); expect(analyticsSurface('@astrojs/cloudflare', 'dev')).toBe('development');
  for (const surface of ['cloudflare', 'netlify', 'vercel', 'deno', 'astro']) expect(() => validateAnalyticsSurface(config({ enabled: true, adapter: { type: 'jsonl' } }), surface)).toThrow('supported Node');
  expect(() => validateAnalyticsSurface(config({ enabled: true, adapter: { type: 'jsonl' } }), 'development', '@astrojs/cloudflare')).toThrow('supported Node');
  expect(() => validateAnalyticsSurface(config({ enabled: true, adapter: { type: 'jsonl' } }), 'preview', '@deno/astro-adapter')).toThrow('supported Node');
  for (const surface of ['node', 'development', 'preview']) expect(() => validateAnalyticsSurface(config({ enabled: true, adapter: { type: 'jsonl' } }), surface)).not.toThrow();
});
test('enabled analytics rejects unobservable static builds and permits declared edge without installing a handler', async () => {
  for (const edge of [false, true]) {
    const middleware = []; const integration = aeo({ analytics: { enabled: true }, markdown: { negotiation: edge ? 'response' : 'off' }, plugins: edge ? [cloudflareEdge()] : [], discovery: { sitemap: { mode: 'disabled' } } });
    await integration.hooks['astro:config:setup']({ config: {}, command: 'build', logger: { warn() {} }, addMiddleware: (value) => middleware.push(value), updateConfig() {} });
    const routes = () => integration.hooks['astro:routes:resolved']({ routes: [{ type: 'page', origin: 'project', pathname: '/', pattern: /^\/$/, route: '/', isPrerendered: true }] });
    if (edge) { expect(routes).not.toThrow(); expect(middleware[0].entrypoint).toBe('astro-aeo/middleware'); }
    else expect(routes).toThrow('observable');
  }
});
test('generated module isolates Node-only sinks, runtime secret resolution, optional peer and setup failure', () => {
  const source = (adapter, surface = 'node', extra = {}) => {
    const plugin = analyticsMiddlewarePlugin(() => ({ config: config({ enabled: true, adapter }), surface, ...extra }));
    return plugin.load(plugin.resolveId(ANALYTICS_MIDDLEWARE_ID));
  };
  const plugin = analyticsMiddlewarePlugin(() => ({ config: config({ enabled: true }), surface: 'node' }));
  expect(plugin.resolveId('astro-aeo/middleware')).toBe(plugin.resolveId(ANALYTICS_MIDDLEWARE_ID));
  expect(source({ type: 'console' }, 'cloudflare')).not.toContain('node:'); expect(source({ type: 'console' }, 'cloudflare')).not.toContain('analytics-node');
  expect(source({ type: 'jsonl' })).toContain('analytics-node');
  const webhook = source({ type: 'webhook', url: 'https://events.test', headers: { authorization: { env: 'RUNTIME_ONLY' } } }, 'cloudflare');
  expect(webhook).toContain('cloudflare:workers'); expect(webhook).toContain('(name) => env[name]'); expect(webhook).not.toContain('process.env');
  expect(source({ type: 'opentelemetry' })).toContain('@opentelemetry/api'); expect(source({ type: 'opentelemetry', endpoint: 'https://otel.test' })).not.toContain('@opentelemetry/api');
  const module = source({ type: 'module', module: './sink.js', options: { safe: true } }, 'node', { specifier: '/project/sink.js' });
  expect(module).toContain('adapter.createSink'); expect(module).not.toContain('() => await'); expect(module).toContain('runtime setup failed');
});
test('module preflight validates setup, sanitizes errors, fails strict configuration and never echoes paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeo-adapter-')); const logger = { warn: vi.fn() };
  try {
    await writeFile(join(root, 'good.mjs'), 'export default { apiVersion: 1, createSink(options) { if (options.safe !== true) throw Error(); return () => {}; } };');
    expect(await preloadAnalytics(config({ enabled: true, adapter: { type: 'module', module: './good.mjs', options: { safe: true } } }), root, logger, async () => ({ default: { apiVersion: 1, createSink: (options) => { if (!options.safe) throw Error(); return () => {}; } } }))).toHaveProperty('specifier');
    await writeFile(join(root, 'bad.mjs'), 'export default { apiVersion: 1, createSink() { throw Error("password=/private"); } };');
    expect(await preloadAnalytics(config({ enabled: true, adapter: { type: 'module', module: './bad.mjs' } }), root, logger, async () => ({ default: { apiVersion: 1, createSink: () => { throw Error('password=/private'); } } }))).toEqual({ failed: true });
    expect(logger.warn.mock.calls[0][0]).not.toContain('password'); expect(logger.warn.mock.calls[0][0]).not.toContain(root);
    await expect(preloadAnalytics(config({ enabled: true, strict: true, adapter: { type: 'module', module: './bad.mjs' } }), root, logger)).rejects.toThrow('preflight');
    await expect(preloadAnalytics(config({ enabled: true, strict: true, adapter: { type: 'jsonl', path: '../escape.jsonl' } }), root, logger)).rejects.toThrow('preflight');
  } finally { await rm(root, { recursive: true, force: true }); }
});

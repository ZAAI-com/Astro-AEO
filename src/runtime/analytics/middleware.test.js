import { test, expect, vi, afterEach } from 'vitest';
import { resolveConfig } from '../../config.js';
import { createAnalyticsMiddleware } from './middleware.js';
const catalog = vi.hoisted(() => ({ pages: /** @type {Promise<{ pathname: string }[]> | undefined} */ (undefined) }));
vi.mock('../serve.js', () => ({ cachedRuntimeCatalogPages: () => catalog.pages }));
afterEach(() => { catalog.pages = undefined; });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const runtime = (command = 'build') => ({ command, config: resolveConfig({}), site: { base: '/docs', siteUrl: 'https://example.com' },
  staticPaths: ['/about'], routePatterns: [{ pattern: /^\/docs\/users\/[^/]+\/?$/, routePattern: '/docs/users/[id]' }] });
const context = (path = '/docs/about') => ({ url: new URL(`https://example.com${path}`), request: new Request(`https://example.com${path}`, { headers: { 'user-agent': 'GPTBot' } }), locals: {}, isPrerendered: false });
test('wrapper snapshots public context before a rewrite, preserves identity and uses provider lifetime', async () => {
  const events = []; const waits = []; const original = new Response('same', { headers: { 'content-type': 'text/html' } }); const input = context('/docs/users/private?never=collect');
  input.locals.waitUntil = (work) => waits.push(work);
  const middleware = createAnalyticsMiddleware(async (ctx) => { ctx.url = new URL('https://example.com/rewritten'); ctx.request = new Request(ctx.url); return original; }, () => false, runtime(), { enabled: true }, (event) => events.push(event));
  expect(await middleware(input)).toBe(original); await waits[0]; expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ path: '/docs/users/[id]' });
  expect(JSON.stringify(events)).not.toContain('private'); expect(original.bodyUsed).toBe(false);
});
test.each(['internal', 'prerender'])('wrapper excludes %s but still runs middleware', async (reason) => {
  const events = []; const input = context(); input.isPrerendered = reason === 'prerender'; const next = vi.fn(async () => new Response('unchanged', { headers: { 'content-type': 'text/html' } }));
  const middleware = createAnalyticsMiddleware(next, () => reason === 'internal', runtime(), { enabled: true }, (event) => events.push(event));
  await middleware(input); await tick(); expect(next).toHaveBeenCalledTimes(1); expect(events).toEqual([]);
});
test('development console is mandatory alongside a custom sink, and prerendered dev previews remain observable', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}); const sink = vi.fn(); const input = context(); input.isPrerendered = true;
  const middleware = createAnalyticsMiddleware(async () => new Response('same', { headers: { 'content-type': 'text/html' } }), () => false, runtime('dev'), { enabled: true, adapter: { type: 'module', module: './sink.js' } }, sink);
  await middleware(input); await tick(); expect(log).toHaveBeenCalledWith(expect.stringContaining('astro-aeo:analytics-v1 ')); expect(sink).toHaveBeenCalledOnce(); log.mockRestore();
});
test('direct dynamic companions and corpus paths are bounded artifact identities', async () => {
  const events = []; const middleware = createAnalyticsMiddleware(async () => new Response('same', { headers: { 'content-type': 'text/html' } }), () => false, runtime(), { enabled: true }, (event) => events.push(event));
  await middleware(context('/docs/users/private.md')); await middleware(context('/docs/llms-full.txt')); await tick();
  expect(events.map((event) => [event.path, event.pathKind])).toEqual([['/docs/users/[id].md', 'artifact'], ['/docs/llms-full.txt', 'artifact']]);
});
const html = () => new Response('same', { headers: { 'content-type': 'text/html' } });
test('an in-flight catalog listing never delays the response and refreshes inventory in the background', async () => {
  /** @type {(pages: { pathname: string }[]) => void} */
  let finish = () => {};
  catalog.pages = new Promise((resolve) => { finish = resolve; });
  const events = []; const original = html();
  const middleware = createAnalyticsMiddleware(async () => original, () => false, runtime(), { enabled: true }, (event) => events.push(event));
  expect(await Promise.race([middleware(context('/docs/users/listed')), tick().then(() => 'delayed')])).toBe(original);
  finish([{ pathname: '/users/listed' }]); await tick();
  await middleware(context('/docs/users/listed')); await tick();
  expect(events.map((event) => [event.path, event.pathKind])).toEqual([['/docs/users/[id]', 'pattern'], ['/docs/users/listed', 'inventory']]);
});
test('a settled catalog listing classifies the same request', async () => {
  catalog.pages = Promise.resolve([{ pathname: '/users/listed' }]);
  const events = []; const middleware = createAnalyticsMiddleware(async () => html(), () => false, runtime(), { enabled: true }, (event) => events.push(event));
  await middleware(context('/docs/users/listed')); await tick();
  expect(events.map((event) => event.pathKind)).toEqual(['inventory']);
});
test('a failed catalog listing leaves the response and route classification unchanged', async () => {
  const failed = Promise.reject(new Error('private listing failure')); failed.catch(() => {}); catalog.pages = failed;
  const events = []; const original = html();
  const middleware = createAnalyticsMiddleware(async () => original, () => false, runtime(), { enabled: true }, (event) => events.push(event));
  expect(await middleware(context('/docs/users/listed'))).toBe(original); await middleware(context('/docs/users/listed')); await tick();
  expect(events.map((event) => event.pathKind)).toEqual(['pattern', 'pattern']); expect(JSON.stringify(events)).not.toContain('private');
});

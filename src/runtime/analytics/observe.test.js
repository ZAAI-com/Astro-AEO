import { describe, test, expect, vi } from 'vitest';
import { createAnalytics, classifyCrawler } from '../../analytics.js';

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(options = {}) {
  const events = [];
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const observer = createAnalytics({ enabled: true, base: '/docs', inventory: ['/docs/about'],
    artifacts: ['/docs/about.md', '/docs/llms.txt'],
    patterns: [{ pattern: /^\/docs\/users\/[^/]+$/, routePattern: '/docs/users/[id]' }],
    clock: () => Date.parse('2026-10-03T10:12:59.999Z'), random: () => 0.25,
    sink: (event) => { events.push(event); }, logger, ...options });
  return { observer, events, logger };
}
const response = () => new Response('untouched', { headers: { 'content-type': 'text/html' } });
const request = (path = '/docs/about', ua = 'Mozilla GPTBot/1.0', method = 'GET') => new Request(`https://example.com${path}`, { method, headers: { 'user-agent': ua } });

describe('privacy-first observation', () => {
  test('preserves Response identity, unread body and minute-rounded bounded event', async () => {
    const { observer, events } = setup(); const original = response();
    expect(observer.observe(request('/docs/about?secret=never'), original)).toBe(original);
    await drain(); expect(original.bodyUsed).toBe(false);
    expect(events).toEqual([{ version: 1, type: 'request', timestamp: '2026-10-03T10:12:00.000Z', registryVersion: '2',
      method: 'GET', status: 200, path: '/docs/about', pathKind: 'inventory', crawler: { identity: 'GPTBot', classification: 'claimed' },
      representation: 'html', cache: 'unknown', surface: 'astro', sampleRate: 1, scope: 'agents', coverage: 'observable-only' }]);
    expect(Object.isFrozen(events[0])).toBe(true); expect(Object.isFrozen(events[0].crawler)).toBe(true);
  });
  test('request traps permit only method, pathname and User-Agent; response body is never accessed', async () => {
    const { observer, events } = setup();
    const headers = { get(name) { if (name !== 'user-agent') throw new Error('Prohibited header'); return 'GPTBot'; } };
    const input = new Proxy({ method: 'HEAD', headers }, { get(target, name) { if (!(name in target)) throw new Error('Prohibited request data'); return target[name]; } });
    const output = new Proxy({ status: 304, headers: { get(name) { if (name !== 'content-type') throw new Error('Prohibited response data'); return 'text/markdown'; } } }, {
      get(target, name) { if (!(name in target)) throw new Error('Body access'); return target[name]; },
    });
    expect(observer.observe(input, output, { pathname: '/docs/about' })).toBe(output);
    await drain(); expect(events[0]).toMatchObject({ method: 'HEAD', cache: 'not-modified', representation: 'markdown' });
  });
  test.each([{ internal: true }, { prerendered: true }])('excludes internal and prerender collection: %j', async (details) => {
    const { observer, events } = setup(); observer.observe(request(), response(), details); await drain(); expect(events).toEqual([]);
  });
  test.each(['POST', 'PUT', 'OPTIONS', 'DELETE'])('excludes %s without reading headers', async (method) => {
    const { observer, events } = setup(); observer.observe({ method, get headers() { throw new Error('Read'); } }, response()); await drain(); expect(events).toEqual([]);
  });
  test.each(['/else', '/docsmith', '/docs/%2e%2e/private', '/docs/%00bad'])('excludes out-of-base or unsafe %s', async (path) => {
    const { observer, events } = setup(); observer.observe(request(path), response()); await drain(); expect(events).toEqual([]);
  });
  test('agent scope includes known artifacts, excludes ordinary unknown HTML and bounds unknown paths', async () => {
    const { observer, events } = setup(); observer.observe(request('/docs/about', 'Mozilla'), response());
    observer.observe(request('/docs/llms.txt', 'Mozilla'), response()); observer.observe(request('/docs/private-secret', 'GPTBot'), response());
    await drain(); expect(events.map(({ path, pathKind }) => [path, pathKind])).toEqual([['/docs/llms.txt', 'artifact'], ['(unlisted)', 'unlisted']]);
    expect(JSON.stringify(events)).not.toContain('private-secret');
  });
  test('route parameters and User-Agent suffixes never enter an all-traffic event', async () => {
    const { observer, events } = setup({ scope: 'all' }); observer.observe(request('/docs/users/sensitive-token?q=secret', 'Mozilla secret-user'), response());
    await drain(); expect(events[0]).toMatchObject({ path: '/docs/users/[id]', pathKind: 'pattern', crawler: { identity: 'unknown' } });
    expect(JSON.stringify(events)).not.toContain('secret'); expect(JSON.stringify(events)).not.toContain('sensitive');
  });
  test('stateful patterns do not alternate or mutate caller regexes', async () => {
    const pattern = /^\/docs\/users\/[^/]+$/g; const { observer, events } = setup({ patterns: [{ pattern, routePattern: '/docs/users/[id]' }] });
    observer.observe(request('/docs/users/1'), response()); observer.observe(request('/docs/users/2'), response()); await drain();
    expect(events.every((event) => event.pathKind === 'pattern')).toBe(true); expect(pattern.lastIndex).toBe(0);
  });
  test('sampling uses deterministic RNG, reports inclusion rate and skips rate zero', async () => {
    const { observer, events } = setup({ sampleRate: 0.5 }); observer.observe(request(), response()); await drain(); expect(events[0].sampleRate).toBe(0.5);
    const rejected = setup({ sampleRate: 0.2 }); rejected.observer.observe(request(), response()); await drain(); expect(rejected.events).toEqual([]);
    const zero = setup({ sampleRate: 0, random: () => { throw new Error('RNG'); } }); zero.observer.observe(request(), response()); expect(zero.logger.warn).not.toHaveBeenCalled();
  });
  test.each([false, undefined])('disabled=%s reads no request properties and invokes no sink', async (enabled) => {
    const { observer, events } = setup({ enabled }); const original = response();
    expect(observer.observe(new Proxy({}, { get() { throw new Error('Access'); } }), original)).toBe(original); await drain(); expect(events).toEqual([]);
  });
  test.each([false, true])('failure is sanitized, caught, reported once with strict=%s; response unchanged', async (strict) => {
    const { observer, logger } = setup({ strict, sink: () => { throw new Error('password=/private/root'); } });
    const original = response(); expect(observer.observe(request(), original)).toBe(original); observer.observe(request(), response()); await drain();
    const log = strict ? logger.error : logger.warn; expect(log).toHaveBeenCalledTimes(1); expect(log.mock.calls[0][0]).not.toContain('password');
  });
  test('supported waitUntil receives caught delivery; thrown lifetime callback never changes HTTP', async () => {
    const work = []; const { observer } = setup({ sink: () => Promise.reject(new Error('secret')) }); const original = response();
    expect(observer.observe(request(), original, { waitUntil: (promise) => work.push(promise) })).toBe(original); await expect(work[0]).resolves.toBeUndefined();
    expect(observer.observe(request(), original, { waitUntil: () => { throw new Error('secret'); } })).toBe(original);
  });
  test('classifications are bounded claims, never policy-only tokens or substrings', () => {
    for (const ua of ['Google-Extended', 'Applebot-Extended', 'NotGPTBot', 'x'.repeat(5000) + 'GPTBot']) expect(classifyCrawler(ua).identity).toBe('unknown');
    expect(classifyCrawler('Applebot/1.0').identity).toBe('Applebot'); expect(classifyCrawler('Mozilla (compatible; ChatGPT-User/1.0)')).toMatchObject({ identity: 'ChatGPT-User', classification: 'claimed' });
  });
});

test('agent scope excludes crawler asset traffic but includes negotiated Markdown without a crawler claim', async () => {
  const { observer, events } = setup();
  observer.observe(request('/docs/about'), new Response('image', { headers: { 'content-type': 'image/png' } }));
  observer.observe(request('/docs/about', 'Mozilla'), new Response('markdown', { headers: { 'content-type': 'text/markdown' } }));
  await drain(); expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ representation: 'markdown', crawler: { classification: 'unclassified' } });
});
test('runtime inventory providers invalidate path indexes only when their held array changes', async () => {
  let inventory = ['/docs/first']; const { observer, events } = setup({ inventory: () => inventory });
  observer.observe(request('/docs/first'), response()); inventory = ['/docs/second']; observer.observe(request('/docs/first'), response()); observer.observe(request('/docs/second'), response());
  await drain(); expect(events.map(({ path }) => path)).toEqual(['/docs/first', '(unlisted)', '/docs/second']);
});

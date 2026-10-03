import { test, expect, vi } from 'vitest';
import { createCloudflareHandler } from './cloudflare.js';
import { createNetlifyHandler } from './netlify.js';
import { createVercelHandler } from './vercel.js';
import { createAnalytics } from '../../analytics.js';
const request = () => new Request('https://example.test/page', { headers: { 'user-agent': 'GPTBot' } });
const manifest = () => new Response(JSON.stringify({ version: 1, mode: 'response', routes: [] }));

test.each(['cloudflare', 'netlify', 'vercel'])('%s injection observes public responses once with supported lifetime and no body consumption', async (provider) => {
  const events = []; const waits = []; const waitUntil = (work) => waits.push(work); const original = new Response('same', { headers: { 'content-type': 'text/html' } });
  const analytics = createAnalytics({ enabled: true, inventory: ['/page'], sink: (event) => events.push(event) });
  let returned;
  if (provider === 'cloudflare') returned = await createCloudflareHandler({ analytics }).fetch(request(), { ASSETS: { fetch: async (input) => input.url.endsWith('json') ? manifest() : original } }, { waitUntil });
  if (provider === 'netlify') returned = await createNetlifyHandler({ analytics })(request(), { waitUntil, next: async (input) => input ? manifest() : original });
  if (provider === 'vercel') returned = await createVercelHandler({ analytics, waitUntil, fetch: async () => manifest(), next: () => original, rewrite: () => { throw Error(); } })(request());
  expect(returned).toBe(original); expect(original.bodyUsed).toBe(false); expect(waits).toHaveLength(1); await waits[0]; expect(events).toHaveLength(1); expect(events[0].surface).toBe(provider);
});
test('Cloudflare Pages uses its context lifetime and failing injected observers cannot change HTTP', async () => {
  const original = new Response('same', { headers: { 'content-type': 'text/html' } }); const observer = { observe: vi.fn(() => { throw new Error('secret'); }) };
  const handler = createCloudflareHandler({ analytics: observer }); expect(await handler.onRequest({ request: request(), env: {}, next: async () => original })).toBe(original); expect(observer.observe).toHaveBeenCalledOnce();
});
test('Vercel subrequests explicitly carry only a reserved nonvisitor User-Agent and are excluded', async () => {
  const calls = []; const original = new Response('same', { headers: { 'content-type': 'text/html' } });
  const handler = createVercelHandler({ fetch: async (url, init) => { calls.push(init); return url.pathname.endsWith('json') ? new Response(JSON.stringify({ version: 1, mode: 'response', routes: [{ html: '/page', markdown: '/page.md' }] })) : new Response(null); },
    next: () => original, rewrite: () => original });
  await handler(new Request('https://example.test/page', { headers: { accept: 'text/markdown', authorization: 'never-forward' } }));
  expect(calls).toHaveLength(2); expect(calls.every((init) => new Headers(init.headers).get('user-agent') === 'astro-aeo-internal/1')).toBe(true);
  const sink = vi.fn(); const analytics = createAnalytics({ enabled: true, artifacts: ['/page.md'], sink });
  analytics.observe(new Request('https://example.test/page.md', { headers: { 'user-agent': 'astro-aeo-internal/1' } }), original); await Promise.resolve(); expect(sink).not.toHaveBeenCalled();
});

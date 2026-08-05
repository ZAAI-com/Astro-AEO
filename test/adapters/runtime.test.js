import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { join } from 'node:path';
import {
  ASTRO_BIN,
  buildAdapter,
  executableAvailable,
  fixture,
  startProcess,
  stopProcess,
  waitForReady,
} from './helpers.js';

const explicitRuntimes = process.env.ASTRO_AEO_ADAPTER_RUNTIMES;
const selected = new Set((explicitRuntimes ?? 'node,cloudflare,deno').split(',').map((name) => name.trim()));
const unknownRuntimes = [...selected].filter((name) => !['node', 'cloudflare', 'deno'].includes(name));
if (selected.has('') || unknownRuntimes.length > 0) {
  throw new Error(
    `ASTRO_AEO_ADAPTER_RUNTIMES must contain node, cloudflare, or deno; received ${
      explicitRuntimes ?? ''
    }`,
  );
}

const acceptCases = [
  {
    label: 'weighted Markdown preference',
    accept: 'text/html;q=0.7, text/markdown;q=0.9',
    contentType: 'text/markdown',
  },
  {
    label: 'weighted HTML preference',
    accept: 'text/html;q=0.9, text/markdown;q=0.7',
    contentType: 'text/html',
  },
  {
    label: 'equal-weight tie',
    accept: 'text/markdown;q=0.8, text/html;q=0.8',
    contentType: 'text/html',
  },
  { label: 'wildcard-only preference', accept: '*/*', contentType: 'text/html' },
  {
    label: 'malformed Markdown preference',
    accept: 'text/markdown;q=not-a-number',
    contentType: 'text/html',
  },
  {
    label: 'partially malformed preference',
    accept: 'text/markdown, text/html;q=garbage',
    contentType: 'text/html',
  },
  {
    label: 'malformed media parameter',
    accept: 'text/markdown;garbage',
    contentType: 'text/html',
  },
  {
    label: 'browser preference',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8',
    contentType: 'text/html',
  },
];

const runtimes = [
  {
    name: 'node',
    origin: 'http://127.0.0.1:4571',
    base: 'http://127.0.0.1:4571/docs',
    available: true,
    start() {
      return startProcess(process.execPath, [join(fixture('node'), 'dist/server/entry.mjs')], {
        env: { HOST: '127.0.0.1', PORT: '4571' },
      });
    },
  },
  {
    name: 'cloudflare',
    origin: 'http://127.0.0.1:4572',
    base: 'http://127.0.0.1:4572/docs',
    available: executableAvailable(process.execPath),
    start() {
      return startProcess(process.execPath, [
        ASTRO_BIN,
        'preview',
        '--root',
        fixture('cloudflare'),
        '--host',
        '127.0.0.1',
        '--port',
        '4572',
      ]);
    },
  },
  {
    name: 'deno',
    origin: 'http://127.0.0.1:4513',
    base: 'http://127.0.0.1:4513/docs',
    available: executableAvailable('deno'),
    start() {
      return startProcess('deno', [
        'run',
        '--frozen',
        '--allow-net',
        '--allow-read',
        '--allow-env',
        join(fixture('deno'), 'dist/server/entry.mjs'),
      ]);
    },
  },
];

for (const runtime of runtimes) {
  const requested = selected.has(runtime.name);
  const optionalAndMissing = requested && !runtime.available && explicitRuntimes === undefined;

  describe.skipIf(!requested || optionalAndMissing)(`${runtime.name} request contract`, () => {
    let server;

    beforeAll(async () => {
      if (!runtime.available) {
        throw new Error(`${runtime.name} was explicitly selected but its local runtime is unavailable`);
      }
      buildAdapter(runtime.name);
      server = runtime.start();
      await waitForReady(runtime.base, server);
    });

    afterAll(async () => {
      await stopProcess(server?.child);
    });

    test('boots and serves an on-demand HTML page', async () => {
      const response = await fetch(`${runtime.base}/about/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('vary')).toContain('Accept');
      const body = await response.text();
      expect(body).toContain('ADAPTER-RUNTIME-MARKER');
      expect(body).toContain(
        '<link rel="alternate" type="text/markdown" href="/docs/about.md">',
      );
    });

    test('escapes decoded path bytes in runtime alternate links', async () => {
      const response = await fetch(
        `${runtime.base}/%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E`,
        { headers: { accept: 'text/html' } },
      );
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('href="/docs/&quot;&gt;&lt;img');
      expect(body).not.toContain('<img src=x onerror=alert(1)>');
    });

    test('serves a direct Markdown companion', async () => {
      const response = await fetch(`${runtime.base}/about.md`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      expect(response.headers.get('etag')).toBeTruthy();
      expect(response.headers.get('cache-control')).toBe('private, max-age=45');
      expect(response.headers.get('content-language')).toBe('en');
      expect(response.headers.get('x-adapter-header')).toBe('preserved');
      const body = await response.text();
      expect(body).toContain('# Adapter About');
      expect(body).toContain('ADAPTER-RUNTIME-MARKER');
    });

    test('preserves query strings through the base-prefixed rewrite', async () => {
      const response = await fetch(`${runtime.base}/about.md?value=edge`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('QUERY-edge');
    });

    test('preserves standalone source through the raw registry', async () => {
      const response = await fetch(`${runtime.base}/source.md`);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('[reference link][about]');
      expect(body).toContain('[about]: /docs/about/');
      expect(body).not.toContain('prerender: false');
    });

    test('passes direct Markdown through application authorization', async () => {
      const unauthorized = await fetch(`${runtime.base}/protected.md`);
      const authorized = await fetch(`${runtime.base}/protected.md`, {
        headers: { authorization: 'Bearer adapter-secret' },
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get('x-auth')).toBe('required');
      expect(authorized.status).toBe(200);
      expect(await authorized.text()).toContain('# Adapter Protected');
    });

    test('preserves same-origin redirects and converts only their target', async () => {
      const response = await fetch(`${runtime.base}/old.md`, { redirect: 'manual' });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/docs/about.md?from=old');
    });

    test('passes non-HTML endpoints through unchanged', async () => {
      const response = await fetch(`${runtime.base}/api.md`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('x-api')).toBe('preserved');
      expect(await response.json()).toEqual({ kind: 'adapter-api' });
    });

    test('does not hijack literal project-owned Markdown endpoints or redirects', async () => {
      const endpoint = await fetch(`${runtime.base}/feed.md`);
      const dynamicEndpoint = await fetch(`${runtime.base}/project/example.md`);
      const redirect = await fetch(`${runtime.base}/legacy.md`, { redirect: 'manual' });
      expect(endpoint.status).toBe(200);
      expect(endpoint.headers.get('content-type')).toContain('text/plain');
      expect(endpoint.headers.get('x-literal-md')).toBe('project');
      expect(await endpoint.text()).toBe('LITERAL-MD-ENDPOINT');
      expect(dynamicEndpoint.status).toBe(200);
      expect(dynamicEndpoint.headers.get('x-literal-md')).toBe('project');
      expect(await dynamicEndpoint.text()).toBe('LITERAL-MD-ENDPOINT');
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('location')).toBe('/docs/about/?from=literal-md');
    });

    test('rejects encoded separator traversal before policy checks or rewrites', async () => {
      for (const pathname of ['/..%2fprotected.md', '/foo%2f..%2fprotected.md']) {
        const response = await fetch(`${runtime.base}${pathname}`, {
          headers: { authorization: 'Bearer adapter-secret' },
        });
        expect(response.status, pathname).toBe(400);
        expect(response.headers.get('content-type') ?? '').not.toContain('text/markdown');
        expect(await response.text()).not.toContain('ADAPTER-RUNTIME-MARKER');
      }
    });

    test('converts explicit HTML errors but never negotiates them', async () => {
      const direct = await fetch(`${runtime.base}/broken.md`);
      const negotiated = await fetch(`${runtime.base}/broken`, {
        headers: { accept: 'text/markdown' },
      });
      expect(direct.status).toBe(500);
      expect(direct.headers.get('content-type')).toContain('text/markdown');
      expect(direct.headers.get('x-error')).toBe('preserved');
      expect(await direct.text()).toContain('# Adapter Broken');
      expect(negotiated.status).toBe(500);
      expect(negotiated.headers.get('content-type')).toContain('text/html');
    });

    test('converts a custom 404 only for an explicit Markdown URL', async () => {
      const direct = await fetch(`${runtime.base}/missing/nested.md`);
      const html = await fetch(`${runtime.base}/missing/nested`);
      const negotiated = await fetch(`${runtime.base}/missing/nested`, {
        headers: { accept: 'text/markdown' },
      });
      expect(direct.status).toBe(404);
      expect(direct.headers.get('content-type')).toContain('text/markdown');
      expect(await direct.text()).toContain('# Adapter Not Found');
      expect(html.status).toBe(404);
      expect(html.headers.get('content-type')).toContain('text/html');
      expect(await html.text()).toContain('CUSTOM-404-MARKER');
      expect(negotiated.status).toBe(404);
      expect(negotiated.headers.get('content-type')).toContain('text/html');
      expect(await negotiated.text()).toContain('CUSTOM-404-MARKER');
    });

    test('negotiates Markdown on the page URL', async () => {
      const response = await fetch(`${runtime.base}/about/`, {
        headers: { accept: 'text/markdown' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      expect(response.headers.get('vary')).toContain('Accept');
      expect(response.headers.get('vary')).toContain('Origin');
      expect(await response.text()).toContain('# Adapter About');
    });

    for (const { label, accept, contentType } of acceptCases) {
      test(`resolves the ${label} conservatively`, async () => {
        const response = await fetch(`${runtime.base}/about/`, { headers: { accept } });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(contentType);
      });
    }

    test('loads catalog source without recursing through owned artifacts', async () => {
      const response = await fetch(`${runtime.base}/llms-full.txt`);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
      const body = await response.text();
      expect(body).toContain('# Catalog Dynamic');
      expect(body).toContain('Exact adapter catalog source.');
      expect(body).toContain('# Adapter About');
      expect(body).not.toContain('This must never recurse.');
    });

    test('uses exact catalog source for direct and negotiated Markdown', async () => {
      const direct = await fetch(`${runtime.base}/catalog-dynamic.md`);
      const negotiated = await fetch(`${runtime.base}/catalog-dynamic/`, {
        headers: { accept: 'text/markdown' },
      });

      for (const response of [direct, negotiated]) {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/markdown');
        const body = await response.text();
        expect(body).toContain('# Catalog Dynamic');
        expect(body).toContain('Exact adapter catalog source.');
        expect(body).not.toContain('ADAPTER-RUNTIME-MARKER');
      }
    });

    test('does not trust a spoofed internal-fetch token', async () => {
      const response = await fetch(`${runtime.base}/about`, {
        headers: { accept: 'text/markdown', 'x-astro-aeo-internal': '1' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
    });

    test('supports HEAD and conditional requests', async () => {
      const first = await fetch(`${runtime.base}/about.md`);
      const etag = first.headers.get('etag');
      const head = await fetch(`${runtime.base}/about.md`, { method: 'HEAD' });
      const conditional = await fetch(`${runtime.base}/about.md`, {
        headers: { 'if-none-match': etag },
      });
      expect(head.status).toBe(200);
      for (const header of [
        'etag',
        'content-type',
        'cache-control',
        'content-language',
        'x-adapter-header',
        'link',
        'vary',
      ]) {
        expect(head.headers.get(header), header).toBe(first.headers.get(header));
      }
      expect(await head.text()).toBe('');
      expect(conditional.status).toBe(304);
      expect(conditional.headers.get('etag')).toBe(etag);
      expect(conditional.headers.get('cache-control')).toBe(first.headers.get('cache-control'));
    });

    test('redirect negotiation uses the Markdown URL only for a strict preference', async () => {
      await stopProcess(server?.child);
      server = undefined;
      buildAdapter(runtime.name, { config: 'astro.redirect.config.mjs' });
      server = runtime.start();
      await waitForReady(runtime.base, server);

      const redirected = await fetch(`${runtime.base}/about/?view=redirect`, {
        headers: { accept: 'text/html;q=0.7, text/markdown;q=0.9' },
        redirect: 'manual',
      });
      const tied = await fetch(`${runtime.base}/about/`, {
        headers: { accept: 'text/html, text/markdown' },
        redirect: 'manual',
      });
      expect(redirected.status).toBe(303);
      expect(redirected.headers.get('location')).toBe('/docs/about.md?view=redirect');
      expect(redirected.headers.get('vary')).toContain('Accept');
      expect(tied.status).toBe(200);
      expect(tied.headers.get('content-type')).toContain('text/html');
    });
  });
}

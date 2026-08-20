import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAdapter,
  emittedJavaScript,
  fixture,
  nonEmptyFile,
  readJson,
  unresolvedRelativeImports,
} from './helpers.js';
import { DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL } from '../../src/virtual/plugin.js';

const serverEntryAdapters = ['node', 'cloudflare', 'deno'];

const productionBundleRoots = {
  node: join(fixture('node'), 'dist/server'),
  cloudflare: join(fixture('cloudflare'), 'dist/server'),
  deno: join(fixture('deno'), 'dist/server'),
  vercel: join(fixture('vercel'), '.vercel/output'),
  netlify: join(fixture('netlify'), '.netlify'),
};

const developmentDynamicRouteLoaderSentinels = [
  DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL,
  'astro-aeo:dynamic-routes',
  'astro-aeo-hot-routes-unavailable',
];

const providerRuntimeArtifacts = [
  {
    pathname: '/llms.txt',
    contentType: 'text/plain',
    content: '# Adapter Home',
  },
  {
    pathname: '/llms-full.txt',
    contentType: 'text/plain',
    content: '# Adapter About',
  },
  {
    pathname: '/schema/graph%20data.jsonld',
    contentType: 'application/ld+json',
    content: '"@graph"',
  },
  {
    pathname: '/schema/caf%C3%A9-map.xml',
    contentType: 'application/xml',
    content: 'xmlns="https://zaai.com/astro-aeo/schema-map/1"',
  },
  {
    pathname: '/answers%5Bfeed%5D.txt',
    contentType: 'text/plain',
    content: 'PROVIDER-RUNTIME-PLUGIN',
  },
];

describe('adapter build gates', () => {
  test.each(['node', 'cloudflare', 'deno', 'vercel', 'netlify'])('%s builds successfully', (name) => {
    expect(() => buildAdapter(name)).not.toThrow();
  });

  test.each(serverEntryAdapters)('%s emits a complete server module graph', (name) => {
    const server = join(fixture(name), 'dist/server');
    expect(nonEmptyFile(join(server, 'entry.mjs'))).toBe(true);
    expect(nonEmptyFile(join(server, 'virtual_astro_middleware.mjs'))).toBe(true);
    expect(unresolvedRelativeImports(server)).toEqual([]);
  });

  test.each(serverEntryAdapters)('%s leaves runtime corpus paths out of static assets', (name) => {
    const client = join(fixture(name), 'dist/client');
    for (const path of ['llms.txt', 'llms-full.txt', 'docs/llms.txt', 'docs/llms-full.txt']) {
      expect(existsSync(join(client, path)), path).toBe(false);
    }
  });

  test.each(Object.entries(productionBundleRoots))(
    '%s production bundle excludes development dynamic-route loaders',
    (name, root) => {
      const output = emittedJavaScript(root);
      expect(output.length, `${name} emitted JavaScript`).toBeGreaterThan(0);
      for (const sentinel of developmentDynamicRouteLoaderSentinels) {
        expect(output, `${name} bundle contains ${sentinel}`).not.toContain(sentinel);
      }
    },
  );

  test('Cloudflare emits a workerd configuration and an edge-safe bundle', () => {
    const server = join(fixture('cloudflare'), 'dist/server');
    const config = readJson(join(server, 'wrangler.json'));
    expect(config.main).toBe('entry.mjs');
    expect(config.assets?.directory).toBe('../client');
    expect(config.compatibility_flags).toContain('nodejs_compat');

    const output = emittedJavaScript(server);
    expect(output).toContain('astro-aeo');
  });

  test.each(['cloudflare', 'deno'])('%s bundle boots without Turndown\'s CommonJS parser fallback', (name) => {
    const output = emittedJavaScript(join(fixture(name), 'dist/server'));
    expect(output).toContain('DOMParser');
    expect(output).not.toMatch(/require\(["']@mixmark-io\/domino["']\)/);
  });

  test('Vercel emits a Build Output API function with a valid handler', () => {
    const output = join(fixture('vercel'), '.vercel/output');
    const config = readJson(join(output, 'config.json'));
    const functionRoot = join(output, 'functions/_render.func');
    const functionConfig = readJson(join(functionRoot, '.vc-config.json'));
    expect(config.version).toBe(3);
    expect(config.routes).toEqual(expect.arrayContaining([expect.objectContaining({ dest: '_render' })]));
    const status404Fallback = config.routes.findIndex((route) => route.status === 404);
    expect(status404Fallback).toBeGreaterThan(-1);
    for (const routeMarker of [
      '\\.md',
      'llms\\.txt',
      'llms-full\\.txt',
      'robots\\.txt',
      'schema/graph data\\.jsonld',
      'schema/café-map\\.xml',
      'answers\\[feed\\]\\.txt',
    ]) {
      const routeIndex = config.routes.findIndex(
        (route) => route.dest === '_render' && route.src?.includes(routeMarker),
      );
      expect(routeIndex, `missing Vercel _render route for ${routeMarker}`).toBeGreaterThan(-1);
      expect(routeIndex, `${routeMarker} must precede Vercel's status-404 fallback`)
        .toBeLessThan(status404Fallback);
    }
    for (const artifact of providerRuntimeArtifacts) {
      expect(existsSync(join(output, 'static', artifact.pathname.slice(1))), artifact.pathname)
        .toBe(false);
    }
    expect(functionConfig.runtime).toMatch(/^nodejs/);
    expect(nonEmptyFile(join(functionRoot, functionConfig.handler))).toBe(true);
    expect(unresolvedRelativeImports(join(output, '_functions'))).toEqual([]);
  });

  test('Netlify emits its provider config and bundled SSR function', () => {
    const output = join(fixture('netlify'), '.netlify');
    expect(() => readJson(join(output, 'v1/config.json'))).not.toThrow();
    expect(nonEmptyFile(join(output, 'v1/functions/ssr/ssr.mjs'))).toBe(true);
    expect(unresolvedRelativeImports(join(output, 'build'))).toEqual([]);
  });

  test.each(['vercel', 'netlify'])(
    '%s emitted handler serves fallback-routed Markdown and live corpus contracts',
    async (name) => {
      const loadHandler = name === 'vercel'
        ? async () => {
            const entry = join(fixture(name), '.vercel/output/_functions/entry.mjs');
            const loaded = await import(`${pathToFileURL(entry).href}?handler-contract=${Date.now()}`);
            return (request) => loaded.default.fetch(request);
          }
        : async () => {
            const entry = join(fixture(name), '.netlify/build/entry.mjs');
            const loaded = await import(`${pathToFileURL(entry).href}?handler-contract=${Date.now()}`);
            const handler = loaded.createHandler({ notFoundContent: 'BUNDLED-CUSTOM-404' });
            return (request) => handler(request, { ip: '127.0.0.1' });
          };
      const handler = await loadHandler();

      const get = await handler(new Request('https://adapter.example.com/about.md'));
      const etag = get.headers.get('etag');
      expect(get.status).toBe(200);
      expect(get.headers.get('content-type')).toContain('text/markdown');
      expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
      expect(await get.text()).toContain('# Adapter About');

      const head = await handler(new Request('https://adapter.example.com/about.md', { method: 'HEAD' }));
      expect(head.status).toBe(200);
      expect(head.headers.get('etag')).toBe(etag);
      expect(await head.text()).toBe('');

      const conditional = await handler(new Request('https://adapter.example.com/about.md', {
        headers: { 'if-none-match': etag },
      }));
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe('');

      for (const artifact of providerRuntimeArtifacts) {
        const artifactGet = await handler(new Request(`https://adapter.example.com${artifact.pathname}`));
        const artifactEtag = artifactGet.headers.get('etag');
        expect(artifactGet.status, artifact.pathname).toBe(200);
        expect(artifactGet.headers.get('content-type'), artifact.pathname).toContain(artifact.contentType);
        expect(artifactEtag, artifact.pathname).toMatch(/^"[a-f0-9]{64}"$/);
        const artifactBody = await artifactGet.text();
        expect(artifactBody, artifact.pathname).toContain(artifact.content);
        expect(artifactBody, artifact.pathname).not.toContain('BUNDLED-CUSTOM-404');

        const artifactHead = await handler(new Request(
          `https://adapter.example.com${artifact.pathname}`,
          { method: 'HEAD' },
        ));
        expect(artifactHead.status, artifact.pathname).toBe(200);
        expect(artifactHead.headers.get('content-type'), artifact.pathname).toContain(artifact.contentType);
        expect(artifactHead.headers.get('etag'), artifact.pathname).toBe(artifactEtag);
        expect(await artifactHead.text(), artifact.pathname).toBe('');

        const artifactConditional = await handler(new Request(
          `https://adapter.example.com${artifact.pathname}`,
          { headers: { 'if-none-match': artifactEtag } },
        ));
        expect(artifactConditional.status, artifact.pathname).toBe(304);
        expect(artifactConditional.headers.get('etag'), artifact.pathname).toBe(artifactEtag);
        expect(await artifactConditional.text(), artifact.pathname).toBe('');
      }

      const projectArtifact = await handler(new Request('https://adapter.example.com/robots.txt'));
      expect(projectArtifact.status).toBe(200);
      expect(await projectArtifact.text()).toBe('PROJECT-ROBOTS\n');

      const missing = await handler(new Request('https://adapter.example.com/missing/nested.md'));
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('text/markdown');
      const body = await missing.text();
      expect(body).toContain('# 404: Not found');
      expect(body).not.toContain('BUNDLED-CUSTOM-404');

      if (name === 'netlify') {
        const ordinaryMissing = await handler(new Request('https://adapter.example.com/missing/nested'));
        expect(ordinaryMissing.status).toBe(404);
        expect(await ordinaryMissing.text()).toContain('BUNDLED-CUSTOM-404');
      }
    },
  );

  test('Deno entrypoint does not reference Node-only package resolution', () => {
    const entry = readFileSync(join(fixture('deno'), 'dist/server/entry.mjs'), 'utf8');
    expect(entry).not.toMatch(/from ["']node:module["']/);
    expect(existsSync(join(fixture('deno'), 'dist/server/entry.mjs'))).toBe(true);
  });
});

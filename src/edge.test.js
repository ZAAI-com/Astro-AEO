// @ts-check
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { serializeDeploymentFacts } from './build/deployment-facts.js';
import { serializeEdgeManifest } from './build/edge-manifest.js';
import { cloudflareEdge } from './edge/cloudflare.js';
import { netlifyEdge } from './edge/netlify.js';
import { createEdgePlugin, edgeProviderOf } from './edge/plugin.js';
import { vercelEdge } from './edge/vercel.js';
import aeo from './index.js';
import { readEdgeManifest } from './runtime/edge/handler.js';

/** @param {Record<string, unknown>} options @param {Record<string, unknown>} [astroConfig] */
async function setup(options, astroConfig = {}) {
  /** @type {string[]} */
  const warnings = [];
  const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } }, ...options });
  const hooks = /** @type {any} */ (integration.hooks);
  await hooks['astro:config:setup']({
    config: { integrations: [], ...astroConfig },
    command: 'build',
    addMiddleware: vi.fn(),
    updateConfig: vi.fn(),
    logger: { warn: (/** @type {string} */ message) => warnings.push(message), info() {} },
  });
  await hooks['astro:config:done']({
    config: {
      site: new URL('https://example.test'),
      base: '/',
      trailingSlash: 'ignore',
      build: { format: 'directory' },
      root: pathToFileURL(`${tmpdir()}/`),
      ...astroConfig,
    },
    logger: { warn: (/** @type {string} */ message) => warnings.push(message), info() {} },
    injectTypes() {},
  });
  return { hooks, warnings };
}

const NEGOTIATE = { markdown: { negotiation: 'response' } };

describe('static edge plugin', () => {
  test('each provider factory returns a valid, hook-free plugin declaration', () => {
    for (const [plugin, provider] of /** @type {const} */ ([[cloudflareEdge(), 'cloudflare'], [netlifyEdge(), 'netlify'], [vercelEdge(), 'vercel']])) {
      expect(plugin).toMatchObject({ name: `astro-aeo-edge-${provider}`, apiVersion: 1 });
      expect(edgeProviderOf([plugin])).toBe(provider);
    }
    expect(edgeProviderOf([])).toBeNull();
    expect(edgeProviderOf([{ name: 'other', apiVersion: 1, setup() {} }])).toBeNull();
    expect(() => edgeProviderOf([cloudflareEdge(), netlifyEdge()])).toThrow(/at most one/);
    expect(() => edgeProviderOf([createEdgePlugin(/** @type {any} */ ('fastly'))])).toThrow(/unknown/);
  });

  test('replaces the no-adapter negotiation warning, which is exactly the case it serves', async () => {
    const without = await setup(NEGOTIATE);
    expect(without.warnings.join('\n')).toContain('has no adapter');
    const withEdge = await setup({ ...NEGOTIATE, plugins: [cloudflareEdge()] });
    expect(withEdge.warnings.join('\n')).not.toContain('has no adapter');
  });

  test('is rejected when the project configures an adapter', async () => {
    await expect(setup({ ...NEGOTIATE, plugins: [netlifyEdge()] }, { adapter: { name: '@astrojs/netlify' } }))
      .rejects.toThrow(/for sites without an adapter/);
  });

  test('is rejected when negotiation is off', async () => {
    await expect(setup({ plugins: [vercelEdge()] })).rejects.toThrow(/needs markdown\.negotiation/);
  });

  test('is rejected as soon as a project page renders on demand', async () => {
    const { hooks } = await setup({ ...NEGOTIATE, plugins: [cloudflareEdge()] });
    const route = (/** @type {boolean} */ prerender) => ({
      type: 'page', origin: 'project', pattern: '/live', pathname: '/live', entrypoint: 'src/pages/live.astro', prerender,
    });
    expect(() => hooks['astro:routes:resolved']({ routes: [route(true)] })).not.toThrow();
    expect(() => hooks['astro:routes:resolved']({ routes: [route(false)] })).toThrow(/requires every page to be prerendered, but \/live/);
  });
});

describe('edge manifest', () => {
  const pages = [
    { url: 'https://example.com/docs/b/', mdHref: '/docs/b.md' },
    { url: 'https://example.com/docs/', mdHref: '/docs/index.md' },
    { url: 'https://example.com/docs/displaced/', mdHref: '/docs/displaced.md' },
  ];
  const emitted = (/** @type {string} */ pathname, /** @type {string} */ owner) => owner === 'dotmd' && !pathname.includes('displaced');

  test('lists only emitted companions, sorted, and is readable by the handler', () => {
    const text = serializeEdgeManifest({ pages, provider: 'netlify', mode: 'redirect', base: '/docs', emitted });
    expect(JSON.parse(text)).toEqual({
      version: 1,
      provider: 'netlify',
      mode: 'redirect',
      base: '/docs',
      routes: [{ html: '/docs/', markdown: '/docs/index.md' }, { html: '/docs/b/', markdown: '/docs/b.md' }],
    });
    expect(readEdgeManifest(JSON.parse(text))?.routes.size).toBe(2);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('is deterministic whatever order pages were collected in', () => {
    const input = { provider: 'vercel', mode: /** @type {const} */ ('response'), base: '', emitted };
    expect(serializeEdgeManifest({ ...input, pages: [...pages].reverse() })).toBe(serializeEdgeManifest({ ...input, pages }));
  });
});

describe('deployment facts', () => {
  const facts = {
    output: /** @type {const} */ ('static'),
    adapter: null,
    base: '',
    buildFormat: 'directory',
    trailingSlash: 'ignore',
    negotiation: 'response',
    edgeProvider: 'cloudflare',
    ownership: [{ pathname: '/b.md', status: 'emitted' }, { pathname: '/a.md', status: 'emitted' }],
  };

  test('records names and modes only, with an order-independent ownership digest', () => {
    const parsed = JSON.parse(serializeDeploymentFacts(facts));
    expect(Object.keys(parsed)).toEqual([
      'version', 'output', 'adapter', 'base', 'buildFormat', 'trailingSlash', 'negotiation', 'edgeProvider', 'ownershipDigest',
    ]);
    expect(parsed).toMatchObject({ version: 1, base: '/', adapter: null, edgeProvider: 'cloudflare' });
    expect(parsed.ownershipDigest).toMatch(/^sha256:[a-f\d]{64}$/);
    expect(serializeDeploymentFacts({ ...facts, ownership: [...facts.ownership].reverse() })).toBe(serializeDeploymentFacts(facts));
    expect(serializeDeploymentFacts({ ...facts, ownership: [{ pathname: '/a.md', status: 'conflict' }] })).not.toBe(serializeDeploymentFacts(facts));
  });
});

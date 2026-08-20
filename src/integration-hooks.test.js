import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import aeo from './index.js';

/**
 * @param {{ publicSitemap?: boolean; routes?: any[] }} [options]
 * @returns {string}
 */
async function runtimeConfigSource(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-runtime-sitemap-'));
  const publicRoot = join(root, 'public');
  mkdirSync(publicRoot, { recursive: true });
  if (options.publicSitemap) {
    writeFileSync(join(publicRoot, 'sitemap-index.xml'), '<urlset/>');
  }

  try {
    let updated;
    const integration = aeo({ discovery: { robots: { enabled: true } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: { integrations: [], site: new URL('https://example.test') },
      command: 'dev',
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    await integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: pathToFileURL(`${root}/`),
        publicDir: pathToFileURL(`${publicRoot}/`),
      },
      logger,
      injectTypes() {},
    });
    integration.hooks['astro:routes:resolved']({ routes: options.routes ?? [] });

    const plugin = updated.vite.plugins[0];
    const id = plugin.resolveId('astro-aeo:runtime-config');
    return plugin.load(id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   command?: 'dev'|'build'|'preview'|'sync';
 *   buildOutput?: 'static'|'server';
 *   output?: 'static'|'server';
 *   adapter?: boolean;
 *   configFirst?: boolean;
 *   repeatRoutes?: boolean;
 *   srcDir?: string;
 *   userConfig?: any;
 *   routes?: any[];
 *   secondRoutes?: any[];
 * }} [options]
 */
async function runRouteLifecycle(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-route-lifecycle-'));
  const publicRoot = join(root, 'public');
  const distRoot = join(root, 'dist');
  mkdirSync(publicRoot, { recursive: true });
  mkdirSync(distRoot, { recursive: true });
  writeFileSync(
    join(root, 'catalog.mjs'),
    'export default { listPages() { return []; } };\n',
  );
  const warnings = [];
  let updated;
  try {
    const integration = aeo({
      markdown: { enabled: false },
      corpus: { index: { enabled: false }, full: { enabled: false } },
      discovery: { sitemap: { mode: 'disabled' } },
      ...(options.userConfig ?? {}),
    });
    const logger = {
      warn: (message) => warnings.push(message),
      info() {},
      error() {},
      debug() {},
    };
    const rootUrl = pathToFileURL(`${root}/`);
    await integration.hooks['astro:config:setup']({
      config: {
        integrations: [],
        root: rootUrl,
        site: new URL('https://example.test'),
        ...(options.adapter ? { adapter: { name: 'test-adapter' } } : {}),
      },
      command: options.command ?? 'build',
      addMiddleware() {},
      injectRoute() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    const finishConfig = () => integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: rootUrl,
        srcDir: new URL(options.srcDir ?? 'src/', rootUrl),
        publicDir: pathToFileURL(`${publicRoot}/`),
        output: options.output ?? 'static',
        ...(options.adapter ? { adapter: { name: 'test-adapter' } } : {}),
      },
      logger,
      injectTypes() {},
      buildOutput: options.buildOutput ?? 'static',
    });
    const resolveRoutes = () => integration.hooks['astro:routes:resolved']({
      routes: options.routes ?? [],
    });
    if (options.configFirst ?? true) {
      await finishConfig();
      resolveRoutes();
    } else {
      resolveRoutes();
      await finishConfig();
    }
    if (options.repeatRoutes) resolveRoutes();
    if (options.secondRoutes) {
      integration.hooks['astro:routes:resolved']({ routes: options.secondRoutes });
    }

    const plugin = updated.vite.plugins[0];
    const runtimeSource = plugin.load(plugin.resolveId('astro-aeo:runtime-config'));
    const dynamicSource = plugin.load(plugin.resolveId('astro-aeo:dynamic-routes'));
    let diagnostics = [];
    const warningsBeforeBuildDone = [...warnings];
    if ((options.command ?? 'build') === 'build') {
      await integration.hooks['astro:build:done']({
        dir: pathToFileURL(`${distRoot}/`),
        pages: [],
        assets: new Map(),
        logger,
      });
      diagnostics = JSON.parse(
        readFileSync(join(root, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
      ).diagnostics;
    }
    return { warnings, warningsBeforeBuildDone, diagnostics, runtimeSource, dynamicSource };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const dynamicRoute = (overrides = {}) => ({
  type: 'page',
  origin: 'project',
  pathname: undefined,
  entrypoint: 'src/pages/products/[slug].astro',
  pattern: '/products/[slug]',
  params: ['slug'],
  segments: [
    [{ content: 'products', dynamic: false, spread: false }],
    [{ content: 'slug', dynamic: true, spread: false }],
  ],
  isPrerendered: true,
  ...overrides,
});

describe('integration diagnostics and declarations', () => {
  test('injects adapter-visible fallbacks for Markdown and exact enabled artifact paths', async () => {
    const root = new URL('file:///tmp/astro-aeo-injected-routes/');
    const injected = [];
    let updated;
    const integration = aeo({
      site: { profile: { enabled: true } },
      schema: {
        corpus: {
          enabled: true,
          graphPath: '/semantic/all%20entities.jsonld',
          mapPath: '/semantic/caf%C3%A9-map.xml',
        },
      },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'disabled' } },
      plugins: [
        {
          name: 'build-only',
          apiVersion: 1,
          setup(api) {
            api.claimArtifact({ id: 'build-only', pathname: '/build-only.txt' });
          },
        },
        {
          name: 'runtime-feed',
          apiVersion: 1,
          runtime: { entrypoint: './runtime-feed.js' },
          setup(api) {
            api.claimArtifact({ id: 'runtime-feed', pathname: '/sale-100%25.txt' });
            api.claimArtifact({ id: 'literal-brackets', pathname: '/literal%5Bfeed%5D.txt' });
          },
        },
      ],
    });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: {
        adapter: { name: 'test-adapter' },
        integrations: [],
        root,
        site: new URL('https://example.test'),
      },
      command: 'build',
      injectRoute: (route) => injected.push(route),
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });

    expect(injected.map(({ pattern }) => pattern)).toEqual([
      '/[...astroAeoMarkdown].md',
      '/robots.txt',
      '/.well-known/domain-profile.json',
      '/llms.txt',
      '/llms-full.txt',
      '/semantic/all entities.jsonld',
      '/semantic/café-map.xml',
      '/sale-100%.txt',
      '/literal%5Bfeed%5D.txt',
    ]);
    expect(injected.map(({ pattern }) => pattern)).not.toContain('/build-only.txt');
    expect(injected).toEqual(injected.map((route) => ({ ...route, prerender: false })));
    expect(new Set(injected.map(({ entrypoint }) => entrypoint)).size).toBe(1);

    await integration.hooks['astro:config:done']({
      config: {
        adapter: { name: 'test-adapter' },
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root,
        publicDir: new URL('public/', root),
      },
      logger,
      injectTypes() {},
      buildOutput: 'server',
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        ...injected.map((route) => ({
          type: 'endpoint',
          origin: 'project',
          pathname: route.pattern.includes('[') ? undefined : route.pattern,
          pattern: route.pattern,
          entrypoint: route.entrypoint,
          prerender: false,
        })),
        {
          type: 'endpoint',
          origin: 'project',
          pathname: '/feed.md',
          entrypoint: '/tmp/astro-aeo-injected-routes/src/pages/feed.md.js',
          prerender: false,
        },
      ],
    });

    const plugin = updated.vite.plugins[0];
    const source = plugin.load(plugin.resolveId('astro-aeo:runtime-config'));
    expect(source).toContain('"projectPaths": ["/feed.md"]');
    expect(source).not.toContain('"projectPaths": ["/robots.txt"');
  });

  test('does not inject fallback endpoints for a fully static project', async () => {
    const injected = [];
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    await integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      injectRoute: (route) => injected.push(route),
      addMiddleware() {},
      updateConfig() {},
      logger: { warn() {}, info() {}, error() {}, debug() {} },
    });
    expect(injected).toEqual([]);
  });

  test('treats integration routes as runtime owners without claiming Astro internal routes', async () => {
    let updated;
    const root = new URL('file:///tmp/astro-aeo-integration-ownership/');
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: {
        adapter: { name: 'test-adapter' },
        integrations: [],
        root,
      },
      command: 'build',
      injectRoute() {},
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    await integration.hooks['astro:config:done']({
      config: {
        adapter: { name: 'test-adapter' },
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root,
        publicDir: new URL('public/', root),
      },
      logger,
      injectTypes() {},
      buildOutput: 'server',
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        {
          type: 'endpoint',
          origin: 'external',
          pathname: '/integration.md',
          entrypoint: '/tmp/other-integration/integration-md.js',
          prerender: false,
        },
        {
          type: 'endpoint',
          origin: 'external',
          pathname: '/answers.txt',
          entrypoint: '/tmp/other-integration/answers.js',
          prerender: false,
        },
        {
          type: 'endpoint',
          origin: 'external',
          pattern: '/integration/[slug].md',
          patternRegex: /^\/integration\/([^/]+?)\.md$/,
          entrypoint: '/tmp/other-integration/dynamic-md.js',
          prerender: false,
        },
        {
          type: 'page',
          origin: 'external',
          pattern: '/feeds/[slug].txt',
          patternRegex: /^\/feeds\/([^/]+?)\.txt$/,
          entrypoint: '/tmp/other-integration/dynamic-artifact.js',
          prerender: false,
        },
        {
          type: 'page',
          origin: 'external',
          pattern: '/[...integrationPage]',
          patternRegex: /^\/(.*?)\/?$/,
          entrypoint: '/tmp/other-integration/generic-page.js',
          prerender: false,
        },
        {
          type: 'endpoint',
          origin: 'internal',
          pathname: '/_image',
          entrypoint: '/tmp/astro/internal-image.js',
          prerender: false,
        },
        {
          type: 'endpoint',
          origin: 'internal',
          pattern: '/_internal/[slug].md',
          patternRegex: /^\/_internal\/([^/]+?)\.md$/,
          entrypoint: '/tmp/astro/internal-dynamic.js',
          prerender: false,
        },
      ],
    });

    const plugin = updated.vite.plugins[0];
    const source = plugin.load(plugin.resolveId('astro-aeo:runtime-config'));
    expect(source).toContain('"projectPaths": ["/integration.md", "/answers.txt"]');
    expect(source).toContain('new RegExp("^\\\\/integration\\\\/([^/]+?)\\\\.md$", "")');
    expect(source).toContain('new RegExp("^\\\\/feeds\\\\/([^/]+?)\\\\.txt$", "")');
    expect(source).not.toContain('/_image');
    expect(source).not.toContain('_internal');
    expect(source).not.toContain('integrationPage');
  });

  test('treats app-relative public files as runtime owners under the configured base', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aeo-public-runtime-ownership-'));
    const publicRoot = join(root, 'public');
    mkdirSync(join(publicRoot, 'docs'), { recursive: true });
    writeFileSync(join(publicRoot, 'llms.txt'), 'project corpus');
    writeFileSync(join(publicRoot, 'manual.md'), 'project Markdown');
    writeFileSync(join(publicRoot, 'docs', 'nested.txt'), 'nested public file');

    try {
      let updated;
      const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
      const logger = { warn() {}, info() {}, error() {}, debug() {} };
      await integration.hooks['astro:config:setup']({
        config: {
          adapter: { name: 'test-adapter' },
          integrations: [],
          root: pathToFileURL(`${root}/`),
        },
        command: 'build',
        injectRoute() {},
        addMiddleware() {},
        updateConfig: (value) => { updated = value; },
        logger,
      });
      await integration.hooks['astro:config:done']({
        config: {
          adapter: { name: 'test-adapter' },
          site: new URL('https://example.test'),
          base: '/docs',
          trailingSlash: 'ignore',
          build: { format: 'directory' },
          root: pathToFileURL(`${root}/`),
          publicDir: pathToFileURL(`${publicRoot}/`),
        },
        logger,
        injectTypes() {},
        buildOutput: 'server',
      });
      integration.hooks['astro:routes:resolved']({ routes: [] });

      const plugin = updated.vite.plugins[0];
      const source = plugin.load(plugin.resolveId('astro-aeo:runtime-config'));
      expect(source).toContain('"/docs/nested.txt"');
      expect(source).toContain('"/llms.txt"');
      expect(source).toContain('"/manual.md"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['routes before config completion', false],
    ['routes after config completion', true],
  ])('retains catalog diagnostics once when %s', async (_label, configFirst) => {
    const root = mkdtempSync(join(tmpdir(), 'aeo-catalog-hook-order-'));
    const distRoot = join(root, 'dist');
    const publicRoot = join(root, 'public');
    mkdirSync(distRoot, { recursive: true });
    mkdirSync(publicRoot, { recursive: true });

    try {
      const warnings = [];
      const integration = aeo({
        pages: { catalogs: [{ module: './missing-catalog.js' }] },
        markdown: { enabled: false },
        corpus: { index: { enabled: false }, full: { enabled: false } },
        discovery: { sitemap: { mode: 'disabled' } },
      });
      const logger = {
        warn: (message) => warnings.push(message),
        info() {},
        error() {},
        debug() {},
      };
      await integration.hooks['astro:config:setup']({
        config: { integrations: [] },
        command: 'build',
        addMiddleware() {},
        updateConfig() {},
        logger,
      });

      const resolveRoutes = () =>
        integration.hooks['astro:routes:resolved']({ routes: [] });
      const finishConfig = () =>
        integration.hooks['astro:config:done']({
          config: {
            site: new URL('https://example.test'),
            base: '/',
            trailingSlash: 'ignore',
            build: { format: 'directory' },
            root: pathToFileURL(`${root}/`),
            publicDir: pathToFileURL(`${publicRoot}/`),
          },
          logger,
          injectTypes() {},
        });

      if (configFirst) {
        await finishConfig();
        resolveRoutes();
      } else {
        resolveRoutes();
        await finishConfig();
      }

      await integration.hooks['astro:build:done']({
        dir: pathToFileURL(`${distRoot}/`),
        pages: [],
        assets: new Map(),
        logger,
      });

      const manifest = JSON.parse(
        readFileSync(join(root, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'),
      );
      const failures = manifest.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'catalog-load-failed',
      );
      expect(failures).toEqual([
        expect.objectContaining({ sourcePath: './missing-catalog.js' }),
      ]);
      expect(
        warnings.filter((message) => message.includes('./missing-catalog.js')),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('defers server dynamic-route and custom-404 diagnostics until build completion', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'server',
      buildOutput: 'server',
      userConfig: {
        markdown: { negotiation: 'response' },
        discovery: { sitemap: { mode: 'disabled' } },
      },
      routes: [
        dynamicRoute({ isPrerendered: false }),
        { type: 'page', origin: 'project', pathname: '/404', prerender: true },
        dynamicRoute({ origin: 'internal', isPrerendered: false }),
      ],
    });

    expect(result.warningsBeforeBuildDone).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('request-time corpus enumeration'),
      expect.stringContaining('custom /404 route is prerendered'),
    ]));
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'dynamic-routes-unindexed',
      'prerendered-custom-404-negotiation',
    ]));
  });

  test.each([true, false])(
    'trusts exact static build output for dynamic routes with config-first=%s',
    async (configFirst) => {
      const result = await runRouteLifecycle({
        adapter: true,
        output: 'server',
        buildOutput: 'static',
        configFirst,
        routes: [dynamicRoute()],
      });
      expect(result.warnings.some((message) => message.includes('dynamic page routes'))).toBe(false);
      expect(result.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed')).toBe(false);
    },
  );

  test.each([
    ['prerendered', true],
    ['on-demand', false],
  ])('diagnoses %s dynamic routes for exact server output', async (_label, prerendered) => {
    const result = await runRouteLifecycle({
      buildOutput: 'server',
      routes: [dynamicRoute({ isPrerendered: prerendered })],
    });
    expect(result.warnings).toContainEqual(expect.stringContaining('request-time corpus enumeration'));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'dynamic-routes-unindexed',
    }));
  });

  test.each(['startup', 'hot'])('silently enables %s discovery for prerendered dev routes', async (mode) => {
    const result = await runRouteLifecycle({
      command: 'dev',
      userConfig: { pages: { devDynamicDiscovery: mode } },
      routes: [dynamicRoute()],
    });
    expect(result.warnings.some((message) =>
      message.includes('on-demand dynamic page routes') ||
      message.includes('devDynamicDiscovery is false'))).toBe(false);
    expect(result.runtimeSource).toContain(`mode: ${JSON.stringify(mode)}`);
    if (mode === 'startup') {
      expect(result.dynamicSource).toContain('src/pages/products/[slug].astro');
      expect(result.dynamicSource).toContain('load: () => import(');
    } else {
      expect(result.dynamicSource).toContain('virtual:astro:routes');
      expect(result.dynamicSource).toContain('import.meta.glob("/src/pages/**/*"');
    }
  });

  test.each([
    ['square brackets', 'src[tenant]/', '/src\\[tenant\\]/pages/**/*'],
    ['braces', 'src{tenant}/', '/src\\{tenant\\}/pages/**/*'],
  ])('escapes %s in the hot pages directory glob', async (_label, srcDir, pagesGlob) => {
    const result = await runRouteLifecycle({
      command: 'dev',
      srcDir,
      userConfig: { pages: { devDynamicDiscovery: 'hot' } },
      routes: [dynamicRoute()],
    });

    expect(result.dynamicSource).toContain(`import.meta.glob(${JSON.stringify(pagesGlob)}`);
  });

  test('warns once when development discovery is disabled', async () => {
    const result = await runRouteLifecycle({
      command: 'dev',
      repeatRoutes: true,
      userConfig: { pages: { devDynamicDiscovery: false } },
      routes: [dynamicRoute()],
    });
    expect(result.warnings.filter((message) => message.includes('devDynamicDiscovery is false')))
      .toHaveLength(1);
    expect(result.runtimeSource).toContain('export const DYNAMIC_ROUTE_SOURCE = null');
  });

  test('warns once when an on-demand dynamic development route needs a catalog', async () => {
    const result = await runRouteLifecycle({
      command: 'dev',
      repeatRoutes: true,
      routes: [dynamicRoute({ isPrerendered: false })],
    });
    expect(result.warnings.filter((message) => message.includes('on-demand dynamic page routes')))
      .toHaveLength(1);
  });

  test('a configured catalog suppresses development dynamic-route warnings', async () => {
    const result = await runRouteLifecycle({
      command: 'dev',
      userConfig: {
        pages: {
          devDynamicDiscovery: false,
          catalogs: [{ module: './catalog.mjs' }],
        },
      },
      routes: [dynamicRoute({ isPrerendered: false })],
    });
    expect(result.warnings.some((message) =>
      message.includes('on-demand dynamic page routes') ||
      message.includes('devDynamicDiscovery is false'))).toBe(false);
  });

  test.each(['preview', 'sync'])('keeps %s silent and excludes development loaders', async (command) => {
    const result = await runRouteLifecycle({ command, routes: [dynamicRoute()] });
    expect(result.warnings).toEqual([]);
    expect(result.runtimeSource).toContain('export const DYNAMIC_ROUTE_SOURCE = null');
    expect(result.runtimeSource).not.toContain('import("astro-aeo:dynamic-routes")');
  });

  test('freezes startup route files at the first development resolution', async () => {
    const first = dynamicRoute();
    const added = dynamicRoute({
      entrypoint: 'src/pages/archive/[slug].astro',
      pattern: '/archive/[slug]',
      segments: [
        [{ content: 'archive', dynamic: false, spread: false }],
        [{ content: 'slug', dynamic: true, spread: false }],
      ],
    });
    const result = await runRouteLifecycle({
      command: 'dev',
      routes: [first],
      secondRoutes: [first, added],
    });
    expect(result.dynamicSource).toContain('products/[slug].astro');
    expect(result.dynamicSource).not.toContain('archive/[slug].astro');
  });

  test('filters non-page, non-project, and concrete routes from server diagnostics', async () => {
    const result = await runRouteLifecycle({
      buildOutput: 'server',
      routes: [
        { type: 'endpoint', origin: 'project', pathname: undefined },
        { type: 'redirect', origin: 'project', pathname: undefined },
        { type: 'page', origin: 'project', pathname: '/concrete', prerender: false },
        dynamicRoute({ origin: 'internal' }),
        dynamicRoute({ origin: 'external' }),
      ],
    });
    expect(result.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed')).toBe(false);
  });

  test('treats a null pathname as an unresolved dynamic page', async () => {
    const result = await runRouteLifecycle({
      buildOutput: 'server',
      routes: [dynamicRoute({ pathname: null })],
    });
    expect(result.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed')).toBe(true);
  });

  test('does not diagnose Astro internal dynamic routes', async () => {
    const warnings = [];
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn: (message) => warnings.push(message), info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware() {},
      updateConfig() {},
      logger,
    });
    integration.hooks['astro:routes:resolved']({
      routes: [{ type: 'page', origin: 'internal', pathname: undefined, prerender: false }],
    });
    expect(warnings.some((message) => message.includes('dynamic page routes'))).toBe(false);
  });

  test('runtime corpus candidates contain project pages, not endpoints or error routes', async () => {
    let updated;
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    await integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: new URL('file:///tmp/astro-aeo-route-filter/'),
        publicDir: new URL('file:///tmp/astro-aeo-route-filter/public/'),
        adapter: { name: 'test' },
      },
      logger,
      injectTypes() {},
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        { type: 'page', origin: 'project', pathname: '/about', prerender: false },
        { type: 'endpoint', origin: 'project', pathname: '/api', prerender: false },
        { type: 'redirect', origin: 'project', pathname: '/old', prerender: false },
        { type: 'page', origin: 'project', pathname: '/404', prerender: true },
        { type: 'page', origin: 'project', pathname: '/500', prerender: false },
        {
          type: 'endpoint',
          origin: 'project',
          pathname: undefined,
          pattern: '/project/[slug].md',
          patternRegex: /^\/project\/([^/]+?)\.md$/,
          isPrerendered: false,
        },
        {
          type: 'page',
          origin: 'project',
          pathname: undefined,
          pattern: '/[slug]',
          patternRegex: /^\/([^/]+?)\/?$/,
          isPrerendered: false,
        },
        { type: 'page', origin: 'internal', pathname: '/_image', prerender: false },
      ],
    });

    const plugin = updated.vite.plugins[0];
    const id = plugin.resolveId('astro-aeo:runtime-config');
    const source = plugin.load(id);
    expect(source).toContain('"staticPaths": ["/about"]');
    expect(source).toContain(
      '"projectPaths": ["/about", "/api", "/old", "/404", "/500"]',
    );
    expect(source).not.toContain('"projectPaths": ["/_image"]');
    expect(source).toContain(
      '"projectPatterns": [new RegExp("^\\\\/project\\\\/([^/]+?)\\\\.md$", "")]',
    );
    expect(source).not.toContain('new RegExp("^\\\\/([^/]+?)\\\\/?$", "")');
  });

  test('runtime sitemap availability recognizes public files and concrete routes', async () => {
    expect(await runtimeConfigSource({ publicSitemap: true })).toContain(
      '"sitemapAvailable": true',
    );
    expect(await runtimeConfigSource({
      routes: [
        {
          type: 'endpoint',
          origin: 'project',
          pathname: '/sitemap-index.xml',
          prerender: false,
        },
      ],
    })).toContain('"sitemapAvailable": true');
    expect(await runtimeConfigSource()).toContain('"sitemapAvailable": false');
  });
});

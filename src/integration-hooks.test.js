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

  test('warns for uncataloged dynamic pages and prerendered custom 404s', async () => {
    const warnings = [];
    const injected = [];
    const integration = aeo({
      markdown: { negotiation: 'response' },
      discovery: { sitemap: { mode: 'disabled' } },
    });
    const logger = { warn: (message) => warnings.push(message), info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: { integrations: [], site: new URL('https://example.test') },
      command: 'build',
      addMiddleware() {},
      updateConfig() {},
      logger,
    });
    await integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: new URL('file:///tmp/astro-aeo-hooks/'),
        publicDir: new URL('file:///tmp/astro-aeo-hooks/public/'),
        adapter: { name: 'test' },
      },
      logger,
      injectTypes: (declaration) => injected.push(declaration),
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        { type: 'page', origin: 'project', pathname: undefined, prerender: false },
        { type: 'page', origin: 'project', pathname: '/404', prerender: true },
        { type: 'page', origin: 'internal', pathname: undefined, prerender: false },
      ],
    });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('dynamic page routes are not included'),
      expect.stringContaining('custom /404 route is prerendered'),
    ]));
    expect(injected[0].content).toContain('astroAeoCollect?: boolean');
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

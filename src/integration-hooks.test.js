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
 *   i18n?: any;
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
  const infos = [];
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
      info: (message) => infos.push(message),
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
        ...(options.i18n ? { i18n: options.i18n } : {}),
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
    return { warnings, warningsBeforeBuildDone, infos, diagnostics, runtimeSource, dynamicSource };
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
      '/[astroAeoLocale]/llms.txt',
      '/[astroAeoLocale]/llms-full.txt',
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

  // Astro warns that a static route cannot be defined more than once and intends to
  // make it a hard error. `injectRoute` is available only before any route is
  // resolved, so the only thing injection can consult is the project's page files.
  test('does not inject an artifact path the project already routes itself', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-page-collision-'));
    const rootUrl = pathToFileURL(`${root}/`);
    const pages = join(root, 'src', 'pages');
    mkdirSync(pages, { recursive: true });
    writeFileSync(join(pages, 'llms.txt.ts'), 'export function GET() {}\n');
    // The index spelling routes to the same path, and a page extension counts too.
    mkdirSync(join(pages, 'llms-full.txt'), { recursive: true });
    writeFileSync(join(pages, 'llms-full.txt', 'index.astro'), '<p>owned</p>\n');
    const injected = [];
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    try {
      await integration.hooks['astro:config:setup']({
        config: {
          adapter: { name: 'test-adapter' },
          integrations: [],
          root: rootUrl,
          srcDir: new URL('src/', rootUrl),
          site: new URL('https://example.test'),
        },
        command: 'build',
        injectRoute: (route) => injected.push(route),
        addMiddleware() {},
        updateConfig() {},
        logger: { warn() {}, info() {}, error() {}, debug() {} },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const patterns = injected.map(({ pattern }) => pattern);
    expect(patterns).not.toContain('/llms.txt');
    expect(patterns).not.toContain('/llms-full.txt');
    // Standing down is per path. Everything the project does not route is unaffected,
    // including the locale variants, which are dynamic patterns and cannot collide.
    expect(patterns).toContain('/[astroAeoLocale]/llms.txt');
    expect(patterns).toContain('/[astroAeoLocale]/llms-full.txt');
  });

  test('does not inject fallback endpoints for a static build without an adapter', async () => {
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

  // Astro answers redirect routes in its routing layer, before middleware dispatch, so
  // a project that redirects `/404/` never reaches pre-middleware for an artifact path.
  // Those development servers need the same concrete routes an adapter build receives.
  test('injects fallback endpoints in dev when a redirect owns the 404', async () => {
    const root = new URL('file:///tmp/astro-aeo-dev-injected-routes/');
    const injected = [];
    let updated;
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await integration.hooks['astro:config:setup']({
      config: {
        integrations: [],
        root,
        site: new URL('https://example.test'),
        redirects: { '/404/': '/error/' },
      },
      command: 'dev',
      injectRoute: (route) => injected.push(route),
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });

    expect(injected.map(({ pattern }) => pattern)).toEqual([
      '/[...astroAeoMarkdown].md',
      '/llms.txt',
      '/llms-full.txt',
      '/[astroAeoLocale]/llms.txt',
      '/[astroAeoLocale]/llms-full.txt',
    ]);
    // A dynamic pattern has to render on demand to be dispatched at all, while an
    // exact path is prerendered so its internal rewrites stay in process: Astro
    // forbids an on-demand route from rewriting to a prerendered page.
    expect(Object.fromEntries(injected.map(({ pattern, prerender }) => [pattern, prerender])))
      .toEqual({
        '/[...astroAeoMarkdown].md': false,
        '/llms.txt': true,
        '/llms-full.txt': true,
        '/[astroAeoLocale]/llms.txt': false,
        '/[astroAeoLocale]/llms-full.txt': false,
      });
    expect(new Set(injected.map(({ entrypoint }) => entrypoint)).size).toBe(1);

    await integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root,
        publicDir: new URL('public/', root),
        output: 'static',
      },
      logger,
      injectTypes() {},
      buildOutput: 'static',
    });
    // The fallback routes must never register as project claims: if they did, the
    // runtime would decline every artifact instead of serving it.
    integration.hooks['astro:routes:resolved']({
      routes: [
        ...injected.map((route) => ({
          type: 'endpoint',
          origin: 'project',
          pathname: route.pattern.includes('[') ? undefined : route.pattern,
          pattern: route.pattern,
          entrypoint: route.entrypoint,
          prerender: route.prerender,
        })),
        {
          type: 'endpoint',
          origin: 'project',
          pathname: '/feed.md',
          entrypoint: '/tmp/astro-aeo-dev-injected-routes/src/pages/feed.md.js',
          prerender: false,
        },
      ],
    });

    const plugin = updated.vite.plugins[0];
    const source = plugin.load(plugin.resolveId('astro-aeo:runtime-config'));
    expect(source).toContain('"projectPaths": ["/feed.md"]');
    expect(source).not.toContain('astroAeoMarkdown');
    expect(source).not.toContain('"dynamicPagesUnreachable": true');
  });

  test('leaves an ordinary dev server alone, redirects that do not own the 404 included', async () => {
    const cases = [
      undefined,
      { '/old/': '/new/' },
      { '/404-page/': '/error/' },
      { '/blog/archive/404/': '/error/' },
      // One segment deep, but `blog` is not a configured locale, so this redirects
      // one concrete page and leaves the router's own 404 dispatching middleware.
      { '/blog/404/': '/error/' },
    ];
    for (const redirects of cases) {
      const injected = [];
      const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
      await integration.hooks['astro:config:setup']({
        config: {
          integrations: [],
          site: new URL('https://example.test'),
          ...(redirects ? { redirects } : {}),
        },
        command: 'dev',
        injectRoute: (route) => injected.push(route),
        addMiddleware() {},
        updateConfig() {},
        logger: { warn() {}, info() {}, error() {}, debug() {} },
      });
      expect(injected, `redirects: ${JSON.stringify(redirects)}`).toEqual([]);
    }
  });

  // A locale-prefixed 404 redirect swallows artifacts exactly the same way, and a
  // trailing slash is not significant to Astro's routing.
  test('recognizes a locale-prefixed and slashless 404 redirect', async () => {
    // `de` has to be a locale the project configures, in either spelling Astro
    // accepts, for the prefixed form to mean the router's 404 rather than a page.
    const cases = [
      { redirects: { '/de/404': '/de/error/' }, i18n: { defaultLocale: 'en', locales: ['en', 'de'] } },
      {
        redirects: { '/de/404': '/de/error/' },
        i18n: { defaultLocale: 'en', locales: ['en', { path: 'de', codes: ['de-AT'] }] },
      },
      { redirects: { '/404': '/error' } },
    ];
    for (const { redirects, i18n } of cases) {
      const injected = [];
      const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
      await integration.hooks['astro:config:setup']({
        config: {
          integrations: [],
          site: new URL('https://example.test'),
          redirects,
          ...(i18n ? { i18n } : {}),
        },
        command: 'dev',
        injectRoute: (route) => injected.push(route),
        addMiddleware() {},
        updateConfig() {},
        logger: { warn() {}, info() {}, error() {}, debug() {} },
      });
      expect(injected.map(({ pattern }) => pattern), JSON.stringify(redirects))
        .toContain('/[...astroAeoMarkdown].md');
    }
  });

  // The prefix gate reads the configured locales, so the same redirect decides
  // differently in a project that does not declare the segment as a locale.
  test('ignores a locale-shaped 404 redirect for a segment that is not a locale', async () => {
    const injected = [];
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    await integration.hooks['astro:config:setup']({
      config: {
        integrations: [],
        site: new URL('https://example.test'),
        redirects: { '/de/404/': '/de/error/' },
        i18n: { defaultLocale: 'en', locales: ['en', 'fr'] },
      },
      command: 'dev',
      injectRoute: (route) => injected.push(route),
      addMiddleware() {},
      updateConfig() {},
      logger: { warn() {}, info() {}, error() {}, debug() {} },
    });
    expect(injected).toEqual([]);
  });

  // `serverOutput` is module private, and inline-renderer validation short-circuits
  // outside a build, so no dev-side assertion can read it back directly. What is
  // assertable is that a dev run leaves no residue: injection must not persist into a
  // later build on the same instance, and the build must still validate as fully
  // prerendered, which an inline renderer only survives while `serverOutput` is false.
  test('a dev run leaves a later static build prerendered and free of injected routes', async () => {
    const root = new URL('file:///tmp/astro-aeo-dev-server-output/');
    const injected = [];
    const integration = aeo({
      markdown: { renderers: [() => ''] },
      discovery: { sitemap: { mode: 'disabled' } },
    });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    const setup = (command) => integration.hooks['astro:config:setup']({
      config: {
        integrations: [],
        root,
        site: new URL('https://example.test'),
        redirects: { '/404/': '/error/' },
      },
      command,
      injectRoute: (route) => injected.push(route),
      addMiddleware() {},
      updateConfig() {},
      logger,
    });
    await setup('dev');
    expect(injected.length).toBeGreaterThan(0);
    injected.length = 0;
    await setup('build');
    expect(injected).toEqual([]);

    await integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root,
        publicDir: new URL('public/', root),
        output: 'static',
      },
      logger,
      injectTypes() {},
      buildOutput: 'static',
    });
    expect(() => integration.hooks['astro:routes:resolved']({
      routes: [
        {
          type: 'page',
          origin: 'project',
          pathname: '/about',
          pattern: '/about',
          entrypoint: '/tmp/astro-aeo-dev-server-output/src/pages/about.astro',
          prerender: true,
        },
      ],
    })).not.toThrow();
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
    // The serialized owner is the regular expression, not the parameter name. The dots
    // of a rest parameter once read as a file extension, so a catch-all page owned every
    // `.md` and text artifact path at request time and the name check above still passed.
    expect(source).not.toContain('(.*?)');
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
      expect.stringContaining('request-time middleware owns the corpus'),
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
      expect(result.warnings.some((message) =>
        message.includes('request-time middleware owns the corpus'))).toBe(false);
      expect(result.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed')).toBe(false);
    },
  );

  // Astro-AEO injects `prerender: false` fallback routes for every adapter, which
  // promotes the build to server output. Ownership must therefore key on the
  // project's own pages, never on the build output that promotion produced.
  const corpusConfig = { corpus: { index: { enabled: true }, full: { enabled: true } } };
  const prerenderedHome = { type: 'page', origin: 'project', pathname: '/', isPrerendered: true };

  test('builds the corpus when an adapter promotes server output but every page is prerendered', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'static',
      buildOutput: 'server',
      userConfig: corpusConfig,
      routes: [
        prerenderedHome,
        dynamicRoute(),
        { type: 'endpoint', origin: 'project', pathname: '/api', isPrerendered: false },
      ],
    });
    expect(result.infos).toContainEqual(expect.stringContaining('corpus artifact'));
    expect(result.infos.some((message) =>
      message.includes('request-time middleware owns'))).toBe(false);
    expect(result.diagnostics.some(({ code }) => code === 'dynamic-routes-unindexed')).toBe(false);
    expect(result.warnings.some((message) =>
      message.includes('request-time middleware owns the corpus'))).toBe(false);
  });

  test('leaves the corpus to middleware once a project page renders on demand', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'static',
      buildOutput: 'server',
      userConfig: corpusConfig,
      routes: [
        prerenderedHome,
        { type: 'page', origin: 'project', pathname: '/live', isPrerendered: false },
      ],
    });
    expect(result.infos).toContainEqual(
      expect.stringContaining('request-time middleware owns the configured corpus paths'),
    );
  });

  // The runtime must be able to tell that the build already wrote these bytes, and that
  // a live render would drop the getStaticPaths() results. Both facts are read from the
  // route snapshot, so this also pins the ordering: routes resolve before Vite loads the
  // virtual module, in every command and on every supported Astro major.
  test('tells the runtime the build owns a fully prerendered corpus', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'static',
      buildOutput: 'server',
      userConfig: corpusConfig,
      routes: [
        prerenderedHome,
        dynamicRoute(),
        { type: 'endpoint', origin: 'project', pathname: '/api', isPrerendered: false },
      ],
    });
    expect(result.runtimeSource).toContain('"buildOwnsCorpora": true');
    expect(result.runtimeSource).toContain('"dynamicPagesUnreachable": true');
  });

  test('leaves the corpus to the runtime when a page renders on demand', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'static',
      buildOutput: 'server',
      userConfig: corpusConfig,
      routes: [
        prerenderedHome,
        dynamicRoute(),
        { type: 'page', origin: 'project', pathname: '/live', isPrerendered: false },
      ],
    });
    expect(result.runtimeSource).toContain('"buildOwnsCorpora": false');
  });

  test('never claims build ownership in dev, where nothing has been built', async () => {
    const result = await runRouteLifecycle({
      command: 'dev',
      userConfig: corpusConfig,
      routes: [prerenderedHome, dynamicRoute()],
    });
    expect(result.runtimeSource).toContain('"buildOwnsCorpora": false');
  });

  // Astro rejects prerendered routes under i18n.domains, so a domains project normally
  // has an on-demand page and the runtime already owns the corpus. A project whose pages
  // all come from catalogs has none, and one static file cannot be right for both hosts.
  test('leaves the corpus to middleware when more than one origin is configured', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'server',
      buildOutput: 'server',
      userConfig: corpusConfig,
      i18n: {
        locales: ['en', 'fr'],
        defaultLocale: 'en',
        domains: { fr: 'https://fr.example.test' },
      },
      routes: [prerenderedHome],
    });
    expect(result.infos).toContainEqual(
      expect.stringContaining('request-time middleware owns the configured corpus paths'),
    );
  });

  test('builds the corpus for a catalog-only server project with no on-demand page', async () => {
    const result = await runRouteLifecycle({
      adapter: true,
      output: 'server',
      buildOutput: 'server',
      userConfig: {
        ...corpusConfig,
        pages: { catalogs: [{ module: './catalog.mjs' }] },
      },
      routes: [prerenderedHome],
    });
    expect(result.infos).toContainEqual(expect.stringContaining('corpus artifact'));
    expect(result.infos.some((message) =>
      message.includes('request-time middleware owns'))).toBe(false);
  });

  test.each([
    ['prerendered', true],
    ['on-demand', false],
  ])('diagnoses %s dynamic routes for a runtime-owned corpus', async (_label, prerendered) => {
    const result = await runRouteLifecycle({
      buildOutput: 'server',
      routes: [
        dynamicRoute({ isPrerendered: prerendered }),
        { type: 'page', origin: 'project', pathname: '/live', isPrerendered: false },
      ],
    });
    expect(result.warnings).toContainEqual(expect.stringContaining('request-time middleware owns the corpus'));
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

  test('hot discovery leaves the on-demand warning to the generated loader', async () => {
    // Only the loader sees routes added after the last astro:routes:resolved, so
    // it owns the message. Two owners emitted it twice when the orders interleaved.
    const result = await runRouteLifecycle({
      command: 'dev',
      repeatRoutes: true,
      userConfig: { pages: { devDynamicDiscovery: 'hot' } },
      routes: [dynamicRoute({ isPrerendered: false })],
    });
    expect(result.warnings.some((message) =>
      message.includes('on-demand dynamic page routes'))).toBe(false);
    expect(result.dynamicSource)
      .toContain('console.warn("astro-aeo: on-demand dynamic page routes');
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
      routes: [
        dynamicRoute({ pathname: null }),
        { type: 'page', origin: 'project', pathname: '/live', isPrerendered: false },
      ],
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
    expect(warnings.some((message) =>
      message.includes('request-time middleware owns the corpus'))).toBe(false);
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

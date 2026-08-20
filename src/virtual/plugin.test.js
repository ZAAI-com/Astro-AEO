import { test, expect, describe, vi } from 'vitest';
import {
  aeoRuntimeConfigPlugin,
  DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL,
  DYNAMIC_ROUTES_ID,
  RUNTIME_CONFIG_ID,
} from './plugin.js';
import { resolveConfig } from '../config.js';

let evaluatedHotModule = 0;

async function loadGeneratedHotModule(source, routes, modules) {
  const key = `__astroAeoHotModule${evaluatedHotModule++}`;
  globalThis[key] = { routes, modules };
  const transformed = source
    .replace(
      'const __astroAeoLoadRoutes = async () => {',
      `const __astroAeoTestRoutes = globalThis[${JSON.stringify(key)}].routes;\n` +
      'const __astroAeoLoadRoutes = async () => {',
    )
    .replace(
      '    const value = await import("virtual:astro:routes");',
      '    const value = { routes: __astroAeoTestRoutes };',
    )
    .replace(
      /import\.meta\.glob\([^\n]+\)/,
      `globalThis[${JSON.stringify(key)}].modules`,
    );
  try {
    return await import(`data:text/javascript,${encodeURIComponent(transformed)}#${key}`);
  } finally {
    delete globalThis[key];
  }
}

describe('aeoRuntimeConfigPlugin', () => {
  test('claims only its own module id', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({}));
    expect(plugin.resolveId(RUNTIME_CONFIG_ID)).toBe(`\0${RUNTIME_CONFIG_ID}`);
    expect(plugin.resolveId(DYNAMIC_ROUTES_ID)).toBe(`\0${DYNAMIC_ROUTES_ID}`);
    expect(plugin.resolveId('some-other-module')).toBeUndefined();
    expect(plugin.load('some-other-module')).toBeUndefined();
  });

  test('emits an importable module exporting the snapshot', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({ command: 'dev', config: resolveConfig() }));
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('export const RUNTIME =');
    expect(code).toContain('export const CATALOG_LOADERS = []');
    expect(code).toContain('export const MARKDOWN_RENDERER_LOADERS = []');
    expect(code).toContain('export const RUNTIME_PLUGIN_LOADERS = []');
    expect(code).toContain('export const DYNAMIC_ROUTE_SOURCE = null');
    expect(code).toContain('export default RUNTIME;');

    const { RUNTIME, CATALOG_LOADERS } = new Function(
      `${code.replace(/export const /g, 'const ').replace('export default RUNTIME;', '')} return { RUNTIME, CATALOG_LOADERS };`,
    )();
    expect(RUNTIME.command).toBe('dev');
    expect(RUNTIME.config.markdown.enabled).toBe(true);
    expect(CATALOG_LOADERS).toEqual([]);
  });

  test('catalog modules are emitted as lazy literal imports for edge bundlers', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({}), () => [
      { module: './catalog.js', specifier: 'file:///project/catalog.js' },
      { module: 'pkg/catalog', specifier: 'pkg/catalog' },
    ]);
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('module: "./catalog.js"');
    expect(code).toContain('load: () => import("file:///project/catalog.js")');
    expect(code).toContain('module: "pkg/catalog"');
    expect(code).not.toContain('import * as');
  });

  test('standalone Markdown sources use a virtual raw-import registry', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ standaloneSources: {} }),
      () => [],
      () => [
        {
          pathname: '/guide',
          path: 'src/pages/guide.md',
          specifier: '/project/src/pages/guide.md',
        },
      ],
    );
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('import __astroAeoMarkdown0 from "/project/src/pages/guide.md?raw";');
    expect(code).toContain('RUNTIME.standaloneSources = { "/guide"');
    expect(code).toContain('kind: "markdown"');
    expect(code).toContain('markdown: __astroAeoStripFrontmatter(__astroAeoMarkdown0)');
    expect(code).toContain('__astroAeoStripFrontmatter(__astroAeoMarkdown0)');
  });

  test('standalone MDX carries raw source without treating it as exact Markdown', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ standaloneSources: {} }),
      () => [],
      () => [{
        pathname: '/interactive',
        path: 'src/pages/interactive.mdx',
        specifier: '/project/src/pages/interactive.mdx',
        kind: 'mdx',
      }],
    );
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('import __astroAeoMarkdown0 from "/project/src/pages/interactive.mdx?raw";');
    expect(code).toContain('"/interactive": { kind: "mdx", body:');
    expect(code).not.toContain('markdown: __astroAeoStripFrontmatter');
  });

  test('renderer modules are emitted as lazy literal imports with JSON options', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({}),
      () => [],
      () => [],
      () => [{
        name: 'custom',
        module: './renderer.js',
        specifier: 'file:///project/renderer.js',
        options: { mode: 'safe' },
      }],
    );
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('export const MARKDOWN_RENDERER_LOADERS = [{ name: "custom"');
    expect(code).toContain('options: { "mode": "safe" }');
    expect(code).toContain('load: () => import("file:///project/renderer.js")');
    expect(code).not.toContain('import * as');
  });

  test('runtime plugins are emitted as lazy literal imports with their exact manifest', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({}),
      () => [],
      () => [],
      () => [],
      () => [{
        name: 'feed',
        module: './runtime.js',
        specifier: 'file:///project/runtime.js',
        options: { label: 'Answers' },
        stages: ['artifact:generate', 'artifact:validate'],
        claims: [{ id: 'feed', pathname: '/feed.txt', replace: true }],
      }],
    );
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('export const RUNTIME_PLUGIN_LOADERS = [{ name: "feed"');
    expect(code).toContain('options: { "label": "Answers" }');
    expect(code).toContain('stages: ["artifact:generate", "artifact:validate"]');
    expect(code).toContain('claims: [{ "id": "feed", "pathname": "/feed.txt", "replace": true }]');
    expect(code).toContain('load: () => import("file:///project/runtime.js")');
    expect(code).not.toContain('import * as');
  });

  test('emits omitted runtime options as absent and explicit null as null', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({}),
      () => [],
      () => [],
      () => [],
      () => [
        {
          name: 'omitted', module: './omitted.js', specifier: './omitted.js',
          stages: [], claims: [],
        },
        {
          name: 'explicit', module: './explicit.js', specifier: './explicit.js',
          options: null, stages: [], claims: [],
        },
      ],
    );

    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('module: "./omitted.js", stages: []');
    expect(code).toContain('module: "./explicit.js", options: null, stages: []');
  });

  test('the snapshot is read at load time, not at registration time', () => {
    // Site facts (siteUrl, base, trailingSlash) are captured in astro:config:done,
    // which runs after the plugin is registered. Reading eagerly would emit a
    // snapshot with every one of them empty.
    let siteUrl = '';
    const plugin = aeoRuntimeConfigPlugin(() => ({ siteUrl }));
    siteUrl = 'https://x.com';
    expect(plugin.load(`\0${RUNTIME_CONFIG_ID}`)).toContain('https://x.com');
  });

  test('emits startup discovery as a lazy source with literal route imports', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ command: 'dev' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'startup',
        routes: [{
          entrypoint: 'src/pages/products/[slug].astro',
          specifier: '/project/src/pages/products/[slug].astro',
          pattern: '/products/[slug]',
          params: ['slug'],
          segments: [
            [{ content: 'products', dynamic: false, spread: false }],
            [{ content: 'slug', dynamic: true, spread: false }],
          ],
        }],
      }),
    );

    const runtime = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(runtime).toContain(
      'export const DYNAMIC_ROUTE_SOURCE = { mode: "startup", load: () => import("astro-aeo:dynamic-routes") }',
    );
    expect(runtime).not.toContain('/project/src/pages/products/[slug].astro');

    const routes = plugin.load(`\0${DYNAMIC_ROUTES_ID}`);
    expect(routes).toContain(DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL);
    expect(routes).toContain('entrypoint: "src/pages/products/[slug].astro"');
    expect(routes).toContain('load: () => import("/project/src/pages/products/[slug].astro")');
    expect(routes).not.toContain('getStaticPaths');
  });

  test('emits hot discovery through the private route module and an exhaustive page glob', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ command: 'dev' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'hot',
        routes: [],
        projectRoot: '/project',
        pagesGlob: '/src/pages/**/*',
      }),
    );

    const routes = plugin.load(`\0${DYNAMIC_ROUTES_ID}`);
    expect(routes).toContain(DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL);
    expect(routes).toContain('await import("virtual:astro:routes")');
    expect(routes).toContain('import.meta.glob("/src/pages/**/*", { exhaustive: true })');
    expect(routes).toContain('value.routeData');
    expect(routes).toContain('route.entrypoint ?? route.component');
    expect(routes).toContain('typeof route.pattern === "string" ? route.pattern : route.route');
  });

  test('normalizes wrapper and direct hot route shapes into lazy loaders', async () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ command: 'dev' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'hot',
        routes: [],
        projectRoot: '/project',
        pagesGlob: '/src/pages/**/*',
      }),
    );
    const wrappedLoad = async () => ({ getStaticPaths() {} });
    const directLoad = async () => ({ getStaticPaths() {} });
    const wrapped = {
      type: 'page', origin: 'project', pathname: undefined, prerender: true,
      component: '/src/pages/wrapped/[slug].astro', route: '/wrapped/[slug]',
      params: ['slug'], segments: [[{ content: 'slug', dynamic: true, spread: false }]],
    };
    const direct = {
      type: 'page', origin: undefined, pathname: undefined, isPrerendered: true,
      entrypoint: '/project/src/pages/direct/[slug].astro', route: '/direct/[slug]',
      params: ['slug'], segments: [[{ content: 'slug', dynamic: true, spread: false }]],
    };
    const generated = await loadGeneratedHotModule(
      plugin.load(`\0${DYNAMIC_ROUTES_ID}`),
      [{ routeData: wrapped }, direct],
      {
        '/src/pages/wrapped/[slug].astro': wrappedLoad,
        '/src/pages/direct/[slug].astro': directLoad,
      },
    );

    expect(generated.list[DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL]).toBe(true);
    expect(await generated.list()).toEqual([
      expect.objectContaining({
        entrypoint: '/src/pages/wrapped/[slug].astro',
        pattern: '/wrapped/[slug]',
        load: wrappedLoad,
      }),
      expect.objectContaining({
        entrypoint: '/src/pages/direct/[slug].astro',
        pattern: '/direct/[slug]',
        load: directLoad,
      }),
    ]);
  });

  test('fails closed when the private hot route shape drifts', async () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ command: 'dev' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'hot',
        routes: [],
        projectRoot: '/project',
        pagesGlob: '/src/pages/**/*',
      }),
    );
    const source = plugin.load(`\0${DYNAMIC_ROUTES_ID}`);
    const missingWrapper = await loadGeneratedHotModule(source, [{ candidateRoute: {} }], {});
    await expect(missingWrapper.list()).rejects.toThrow('astro-aeo-hot-routes-unavailable');

    const missingPrerender = await loadGeneratedHotModule(source, [{
      type: 'page', origin: 'project', pathname: undefined,
      component: '/src/pages/drift/[slug].astro', route: '/drift/[slug]',
      params: ['slug'], segments: [[{ content: 'slug', dynamic: true, spread: false }]],
    }], { '/src/pages/drift/[slug].astro': async () => ({}) });
    await expect(missingPrerender.list()).rejects.toThrow('astro-aeo-hot-routes-unavailable');

    const missingModule = await loadGeneratedHotModule(source, [{
      type: 'page', origin: 'project', pathname: undefined, prerender: true,
      component: '/src/pages/unmapped/[slug].astro', route: '/unmapped/[slug]',
      params: ['slug'], segments: [[{ content: 'slug', dynamic: true, spread: false }]],
    }], {});
    await expect(missingModule.list()).rejects.toThrow('astro-aeo-hot-routes-unavailable');
  });

  test('warns once when hot discovery encounters an uncataloged on-demand route', async () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({ command: 'dev' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'hot',
        routes: [],
        projectRoot: '/project',
        pagesGlob: '/src/pages/**/*',
        warnOnDemand: true,
      }),
    );
    const generated = await loadGeneratedHotModule(
      plugin.load(`\0${DYNAMIC_ROUTES_ID}`),
      [{
        type: 'page', origin: 'project', pathname: undefined, prerender: false,
        component: '/src/pages/live/[slug].astro', route: '/live/[slug]',
        params: ['slug'], segments: [[{ content: 'slug', dynamic: true, spread: false }]],
      }],
      { '/src/pages/live/[slug].astro': async () => ({}) },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await generated.list()).toEqual([]);
      expect(await generated.list()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('on-demand dynamic page routes'));
    } finally {
      warn.mockRestore();
    }
  });

  test('escapes startup route mechanics as generated JavaScript data', () => {
    const plugin = aeoRuntimeConfigPlugin(
      () => ({}),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        mode: 'startup',
        routes: [{
          entrypoint: 'src/pages/a"b/[slug].astro',
          specifier: '/project/src/pages/a"b/[slug].astro',
          pattern: '/a"b/[slug]',
          params: ['slug'],
          segments: [[{ content: 'a"b', dynamic: false, spread: false }]],
        }],
      }),
    );
    const routes = plugin.load(`\0${DYNAMIC_ROUTES_ID}`);
    expect(routes).toContain('a\\"b');
    expect(() => new Function(routes.replace('export { list };', ''))).not.toThrow();
  });

  test('keeps the dynamic module unreachable when discovery is disabled', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({ command: 'build' }));
    const runtime = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    const routes = plugin.load(`\0${DYNAMIC_ROUTES_ID}`);
    expect(runtime).toContain('export const DYNAMIC_ROUTE_SOURCE = null');
    expect(runtime).not.toContain('import("astro-aeo:dynamic-routes")');
    expect(routes).not.toContain(DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL);
  });
});

import { test, expect, describe } from 'vitest';
import { aeoRuntimeConfigPlugin, RUNTIME_CONFIG_ID } from './plugin.js';
import { resolveConfig } from '../config.js';

describe('aeoRuntimeConfigPlugin', () => {
  test('claims only its own module id', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({}));
    expect(plugin.resolveId(RUNTIME_CONFIG_ID)).toBe(`\0${RUNTIME_CONFIG_ID}`);
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

  test('the snapshot is read at load time, not at registration time', () => {
    // Site facts (siteUrl, base, trailingSlash) are captured in astro:config:done,
    // which runs after the plugin is registered. Reading eagerly would emit a
    // snapshot with every one of them empty.
    let siteUrl = '';
    const plugin = aeoRuntimeConfigPlugin(() => ({ siteUrl }));
    siteUrl = 'https://x.com';
    expect(plugin.load(`\0${RUNTIME_CONFIG_ID}`)).toContain('https://x.com');
  });
});

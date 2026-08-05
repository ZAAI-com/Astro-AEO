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
    expect(code).toContain('export const CATALOGS = []');
    expect(code).toContain('export default RUNTIME;');

    const { RUNTIME, CATALOGS } = new Function(
      `${code.replace(/export const /g, 'const ').replace('export default RUNTIME;', '')} return { RUNTIME, CATALOGS };`,
    )();
    expect(RUNTIME.command).toBe('dev');
    expect(RUNTIME.config.markdown.enabled).toBe(true);
    expect(CATALOGS).toEqual([]);
  });

  test('catalog modules are emitted as static imports for edge bundlers', () => {
    const plugin = aeoRuntimeConfigPlugin(() => ({}), () => ['./catalog.js', 'pkg/catalog']);
    const code = plugin.load(`\0${RUNTIME_CONFIG_ID}`);
    expect(code).toContain('import * as __astroAeoCatalog0 from "./catalog.js";');
    expect(code).toContain('import * as __astroAeoCatalog1 from "pkg/catalog";');
    expect(code).toContain('__astroAeoCatalog0.default ?? __astroAeoCatalog0');
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
    expect(code).toContain('__astroAeoStripFrontmatter(__astroAeoMarkdown0)');
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

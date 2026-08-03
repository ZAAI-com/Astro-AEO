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
    expect(code).toContain('export default RUNTIME;');

    const { RUNTIME } = new Function(`${code.replace(/export const |export default RUNTIME;/g, (m) => (m === 'export const ' ? 'const ' : ''))} return { RUNTIME };`)();
    expect(RUNTIME.command).toBe('dev');
    expect(RUNTIME.config.markdown.enabled).toBe(true);
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

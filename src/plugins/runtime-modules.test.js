import { describe, expect, test } from 'vitest';
import {
  resolveRuntimePluginSpecifier,
  runtimePluginModules,
} from './runtime-modules.js';

describe('runtime plugin module resolution', () => {
  test('keeps manifest order and resolves local entrypoints from the project root', () => {
    const modules = runtimePluginModules({
      version: 1,
      plugins: [{
        name: 'feed',
        apiVersion: 1,
        entrypoint: './plugins/feed.js',
        options: { format: 'text' },
        stages: ['artifact:generate'],
        claims: [{ id: 'feed', pathname: '/feed.txt' }],
      }],
    }, '/project');

    expect(modules).toEqual([expect.objectContaining({
      name: 'feed',
      module: './plugins/feed.js',
      specifier: 'file:///project/plugins/feed.js',
      options: { format: 'text' },
      stages: ['artifact:generate'],
      claims: [{ id: 'feed', pathname: '/feed.txt' }],
    })]);
  });

  test('keeps omitted runtime options absent while preserving explicit null', () => {
    const modules = runtimePluginModules({
      version: 1,
      plugins: [
        {
          name: 'omitted', entrypoint: './omitted.js', stages: [], claims: [],
        },
        {
          name: 'explicit', entrypoint: './explicit.js', options: null, stages: [], claims: [],
        },
      ],
    }, '/project');

    expect(modules[0]).not.toHaveProperty('options');
    expect(modules[1]).toHaveProperty('options', null);
  });

  test('retains bare package imports and rejects every remote URL scheme', () => {
    expect(resolveRuntimePluginSpecifier('pkg/runtime', '/project')).toBe('pkg/runtime');
    expect(() => resolveRuntimePluginSpecifier('https://example.com/plugin.js', '/project'))
      .toThrow(/remote modules are not supported/);
    expect(() => resolveRuntimePluginSpecifier('data:text/javascript,export default {}', '/project'))
      .toThrow(/remote modules are not supported/);
  });

  test('recognizes Windows drive paths before URL-scheme rejection', () => {
    expect(resolveRuntimePluginSpecifier(
      String.raw`C:\project files\plugin.js?mode=runtime`,
      '/project',
    )).toBe('file:///C:/project%20files/plugin.js?mode=runtime');
  });
});

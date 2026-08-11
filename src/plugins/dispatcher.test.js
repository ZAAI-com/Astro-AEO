import { describe, expect, test } from 'vitest';
import { createPluginDispatcher } from './dispatcher.js';

describe('plugin dispatcher', () => {
  test('runs hooks sequentially with frozen replacement values', async () => {
    const seen = [];
    const plugins = [
      {
        name: 'first', apiVersion: 1,
        setup(api) {
          api.on('page:metadata', ({ value }) => {
            seen.push(Object.isFrozen(value));
            return { action: 'replace', value: { ...value, title: 'first' } };
          });
        },
      },
      {
        name: 'second', apiVersion: 1,
        setup(api) {
          api.on('page:metadata', ({ value }) => {
            seen.push(value.title);
          });
        },
      },
    ];
    const dispatcher = await createPluginDispatcher({ plugins, command: 'build' });
    const result = await dispatcher.run('page:metadata', { title: 'original' });
    expect(seen).toEqual([true, 'first']);
    expect(result.value).toEqual({ title: 'first' });
  });

  test('isolates thrown hooks without persisting thrown values', async () => {
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'broken', apiVersion: 1,
        setup(api) { api.on('graph:build', () => { throw new Error('SECRET'); }); },
      }],
    });
    const result = await dispatcher.run('graph:build', { entries: [] }, { pathname: '/one' });
    expect(result.isolated).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
    expect(result.diagnostics[0]).toMatchObject({ code: 'plugin-hook-failed', pathname: '/one' });
  });

  test('validates exact artifact claims and produces a payload-free runtime manifest', async () => {
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'feed', apiVersion: 1,
        runtime: { entrypoint: './runtime.js', options: { format: 'text' } },
        setup(api) { api.claimArtifact({ id: 'feed', pathname: '/feed.txt' }); },
      }],
    });
    expect(dispatcher.claims).toEqual([{ id: 'feed', pathname: '/feed.txt', plugin: 'feed' }]);
    expect(dispatcher.runtimeManifest.plugins[0]).toMatchObject({ name: 'feed', stages: [] });
  });

  test('rejects duplicate names, reserved names, and traversal claims', async () => {
    const plugin = { name: 'same', apiVersion: 1, setup() {} };
    await expect(createPluginDispatcher({ command: 'build', plugins: [plugin, plugin] })).rejects.toThrow(/duplicate/);
    await expect(createPluginDispatcher({
      command: 'build',
      plugins: [{ name: 'astro-aeo:user', apiVersion: 1, setup() {} }],
    })).rejects.toThrow(/reserved/);
    await expect(createPluginDispatcher({
      command: 'build',
      plugins: [{ name: 'bad', apiVersion: 1, setup(api) { api.claimArtifact({ id: 'x', pathname: '/../x' }); } }],
    })).rejects.toThrow(/failed during setup/);
  });
});

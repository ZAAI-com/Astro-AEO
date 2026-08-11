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

  test('isolates malformed diagnostics and does not run later hooks', async () => {
    let laterRan = false;
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [
        {
          name: 'malformed', apiVersion: 1,
          setup(api) {
            api.on('page:metadata', () => ({ action: 'keep', diagnostics: 'private payload' }));
          },
        },
        {
          name: 'later', apiVersion: 1,
          setup(api) { api.on('page:metadata', () => { laterRan = true; }); },
        },
      ],
    });
    const result = await dispatcher.run('page:metadata', { title: 'original' }, { pathname: '/one' });
    expect(result.isolated).toBe(true);
    expect(laterRan).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'plugin-invalid-diagnostics', pathname: '/one' }),
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('private payload');
  });

  test('retains diagnostic context without retaining plugin-authored message payloads', async () => {
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'reporter', apiVersion: 1,
        setup(api) {
          api.on('page:metadata', () => ({
            action: 'keep',
            diagnostics: [{
              code: 'source-warning',
              severity: 'warning',
              message: 'Authorization: Bearer SECRET <script data-astro-aeo-page>PRIVATE</script>',
            }],
          }));
        },
      }],
    });
    const result = await dispatcher.run('page:metadata', { title: 'original' }, {
      pathname: '/one',
    });

    expect(result.isolated).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'source-warning',
        severity: 'warning',
        pathname: '/one',
        message: 'Plugin "reporter" reported source-warning during page:metadata.',
      }),
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/SECRET|PRIVATE|Authorization|script/);
  });

  test('clones and freezes replacements before public contract validation', async () => {
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'replace', apiVersion: 1,
        setup(api) {
          api.on('page:metadata', ({ value }) => ({
            action: 'replace',
            value: { ...value, title: 'replacement' },
          }));
        },
      }],
    });
    let validatedFrozen = false;
    const result = await dispatcher.run('page:metadata', { title: 'original' }, {
      validate(value) {
        validatedFrozen = Object.isFrozen(value) && Object.getPrototypeOf(value) === null;
        return true;
      },
    });
    expect(result.isolated).toBe(false);
    expect(validatedFrozen).toBe(true);
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

  test('uses the configuration exact-path contract for encoded claims', async () => {
    const encoded = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'encoded', apiVersion: 1,
        setup(api) { api.claimArtifact({ id: 'feed', pathname: '/caf%C3%A9.txt' }); },
      }],
    });
    expect(encoded.claims[0].pathname).toBe('/caf%C3%A9.txt');

    await expect(createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'ambiguous', apiVersion: 1,
        setup(api) { api.claimArtifact({ id: 'feed', pathname: '/caf%c3%a9.txt' }); },
      }],
    })).rejects.toThrow(/failed during setup/);
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

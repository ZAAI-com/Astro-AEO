import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { AeoConfigError } from '../lib/errors.js';
import { createPluginDispatcher, PLUGIN_PAGE_LOSS_CODES } from './dispatcher.js';

/**
 * Setup rewrites every throw as "failed during setup", so capture the error
 * `api.on` raises inside setup to see which validation branch rejected it.
 * @param {string} stage
 * @param {unknown} cache
 */
async function rejectedCacheDeclaration(stage, cache) {
  let error;
  const dispatcher = await createPluginDispatcher({
    command: 'build',
    plugins: [{
      name: 'declares', apiVersion: 1,
      setup(api) {
        try {
          api.on(/** @type {any} */ (stage), () => {}, /** @type {any} */ ({ cache }));
        } catch (caught) {
          error = caught;
        }
      },
    }],
  });
  return { error, registered: dispatcher.hasUserHooks(/** @type {any} */ (stage)) };
}

describe('plugin dispatcher', () => {
  test('exports every isolating failure code the dispatcher emits as a page loss', () => {
    // Read the codes from the emission sites rather than restating them, so a
    // failure code added later fails here instead of silently weakening
    // consumers such as the IndexNow inventory completeness check.
    const source = readFileSync(new URL('./dispatcher.js', import.meta.url), 'utf8');
    const emitted = new Set([...source.matchAll(/failure\([^)]*'(plugin-[a-z-]+)'\)/g)].map((match) => match[1]));
    emitted.delete('plugin-scope-isolated');
    expect([...PLUGIN_PAGE_LOSS_CODES].sort()).toEqual([...emitted].sort());
    expect(PLUGIN_PAGE_LOSS_CODES.includes('plugin-scope-isolated')).toBe(false);
  });


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

  test('rejects cache declarations outside the page and graph stages', async () => {
    for (const stage of ['artifact:generate', 'artifact:validate', 'build:complete']) {
      const { error, registered } = await rejectedCacheDeclaration(stage, { pure: true, version: '1' });
      expect(error).toBeInstanceOf(AeoConfigError);
      expect(error.message).toBe(`astro-aeo: plugin "declares" cannot declare cache behavior for ${stage}.`);
      expect(registered).toBe(false);
    }
  });

  test('rejects malformed cache declarations', async () => {
    for (const cache of [
      null,
      'v1',
      [],
      { pure: false, version: '1' },
      { pure: 'true', version: '1' },
      { pure: true },
      { pure: true, version: 1 },
      { pure: true, version: '   ' },
    ]) {
      const { error, registered } = await rejectedCacheDeclaration('page:metadata', cache);
      expect(error).toBeInstanceOf(AeoConfigError);
      expect(error.message).toBe('astro-aeo: plugin "declares" registered an invalid cache declaration for page:metadata.');
      expect(registered).toBe(false);
    }
  });

  test('records trimmed cache declarations per hook in the runtime manifest', async () => {
    const dispatcher = await createPluginDispatcher({
      command: 'build',
      plugins: [
        {
          name: 'first', apiVersion: 1,
          runtime: { entrypoint: './first.js' },
          setup(api) {
            api.on('graph:build', () => {}, { cache: { pure: true, version: 'graph-1' } });
            api.on('page:metadata', () => {}, { cache: { pure: true, version: ' 2 ' } });
            api.on('page:metadata', () => {});
          },
        },
        {
          name: 'second', apiVersion: 1,
          runtime: { entrypoint: './second.js' },
          setup(api) { api.on('page:metadata', () => {}); },
        },
      ],
    });
    const [first, second] = dispatcher.runtimeManifest.plugins;

    // Stage order follows the lifecycle, not registration order, and ordinals
    // count per plugin per stage, so the runtime gate can pair each hook.
    expect(first.stages).toEqual(['page:metadata', 'graph:build']);
    expect(first.hookManifest).toEqual([
      { stage: 'page:metadata', ordinal: 0, cache: { pure: true, version: '2' } },
      { stage: 'page:metadata', ordinal: 1 },
      { stage: 'graph:build', ordinal: 0, cache: { pure: true, version: 'graph-1' } },
    ]);
    expect(first.hookManifest[1]).not.toHaveProperty('cache');
    expect(second.hookManifest).toEqual([{ stage: 'page:metadata', ordinal: 0 }]);
    expect(second.hookManifest[0]).not.toHaveProperty('cache');
  });

  test('distinguishes omitted runtime options from explicit null', async () => {
    const omitted = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'omitted', apiVersion: 1,
        runtime: { entrypoint: './omitted.js' },
        setup() {},
      }],
    });
    const explicit = await createPluginDispatcher({
      command: 'build',
      plugins: [{
        name: 'explicit', apiVersion: 1,
        runtime: { entrypoint: './explicit.js', options: null },
        setup() {},
      }],
    });

    expect(omitted.runtimeManifest.plugins[0]).not.toHaveProperty('options');
    expect(explicit.runtimeManifest.plugins[0]).toHaveProperty('options', null);
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

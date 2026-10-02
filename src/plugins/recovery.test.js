import { describe, expect, test } from 'vitest';
import { createPluginDispatcher } from './dispatcher.js';
import { runtimePluginModules } from './runtime-modules.js';
import { loadRuntimePlugins } from '../runtime/plugins.js';

async function pipeline(mode, setup, alter = (value) => value) {
  const plugin = { name: 'recovery-test', apiVersion: 1, setup, runtime: { entrypoint: './recover.js' } };
  const build = await createPluginDispatcher({ command: 'build', plugins: [plugin] });
  if (mode === 'build') return build;
  const [descriptor] = runtimePluginModules(build.runtimeManifest, process.cwd());
  return loadRuntimePlugins([{ ...alter(descriptor), load: async () => plugin }]);
}

describe.each(['build', 'runtime'])('%s recoverable hooks', (mode) => {
  test('retains the last valid replacement and continues later hooks after a throw', async () => {
    const seen = [];
    const dispatcher = await pipeline(mode, (api) => {
      api.on('page:metadata', () => ({ action: 'replace', value: { title: 'updated' } }));
      api.on('page:metadata', () => { throw new Error('PRIVATE BODY OR TOKEN'); }, { recoverable: true });
      api.on('page:metadata', ({ value }) => { seen.push(value.title); });
    });
    const result = await dispatcher.run('page:metadata', { title: 'initial' }, { pathname: '/page' });
    expect(result).toMatchObject({ value: { title: 'updated' }, isolated: false });
    expect(seen).toEqual(['updated']);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'plugin-hook-recovered', severity: 'warning' })]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  test.each([
    ['invalid result', () => 'bad'],
    ['invalid diagnostics', () => ({ action: 'keep', diagnostics: 'bad' })],
    ['invalid replacement', () => ({ action: 'replace', value: { title: 3 } })],
    ['explicit isolation', () => ({ action: 'isolate' })],
    ['drop outside RAG', () => ({ action: 'drop' })],
  ])('still isolates %s', async (_name, hook) => {
    let later = false;
    const dispatcher = await pipeline(mode, (api) => {
      api.on('page:metadata', hook, { recoverable: true });
      api.on('page:metadata', () => { later = true; });
    });
    const result = await dispatcher.run('page:metadata', { title: 'initial' }, {
      pathname: '/page', validate: (value) => typeof value.title === 'string',
    });
    expect(result.isolated).toBe(true);
    expect(later).toBe(false);
  });

  test('drops only the current RAG record and stops its remaining hooks', async () => {
    let later = false;
    const dispatcher = await pipeline(mode, (api) => {
      api.on('rag:record', () => ({ action: 'drop' }));
      api.on('rag:record', () => { later = true; });
    });
    const result = await dispatcher.run('rag:record', { text: 'record' }, { pathname: '/page' });
    expect(result).toMatchObject({ isolated: false, dropped: true });
    expect(later).toBe(false);
  });
});

test.each([undefined, false, 'true'])('runtime recovery cannot exceed build authorization (%s)', async (recoverable) => {
  const runtime = await pipeline('runtime', (api) => {
    api.on('page:metadata', () => { throw new Error('private'); }, { recoverable: true });
  }, (descriptor) => ({ ...descriptor, hookManifest: descriptor.hookManifest.map((entry) => ({ ...entry, recoverable })) }));
  const result = await runtime.run('page:metadata', {}, { pathname: '/page' });
  expect(result.isolated).toBe(true);
  expect(result.diagnostics[0].code).toBe('plugin-runtime-module-failed');
});

test('rejects non-boolean recovery at setup, even when no hook runs', async () => {
  await expect(pipeline('build', (api) => api.on('page:metadata', () => {}, { recoverable: 'yes' }))).rejects.toThrow('setup');
});

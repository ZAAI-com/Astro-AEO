import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadRuntimeMarkdownRenderers } from './markdown-renderers.js';

afterEach(() => vi.restoreAllMocks());

describe('runtime Markdown renderer loading', () => {
  test('validates and caches literal module loaders', async () => {
    const render = () => ({ status: 'rendered', markdown: '# Runtime' });
    const load = vi.fn(async () => ({ name: 'runtime', apiVersion: 1, render }));
    const loaders = [{
      name: 'runtime',
      module: './runtime.js',
      options: { nested: { enabled: true } },
      load,
    }];
    const first = await loadRuntimeMarkdownRenderers(loaders);
    const second = await loadRuntimeMarkdownRenderers(loaders);
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
    expect(first[0]).toMatchObject({ name: 'runtime', module: './runtime.js', render });
    expect(Object.isFrozen(first[0].options.nested)).toBe(true);
  });

  test('isolates runtime load and contract failures behind a diagnostic renderer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaders = [{
      name: 'preflight-name',
      module: './changed.js',
      load: async () => ({ name: 'changed-name', apiVersion: 1, render() {} }),
    }];
    const [renderer] = await loadRuntimeMarkdownRenderers(loaders);
    expect(renderer.render()).toMatchObject({
      status: 'continue',
      diagnostics: [{ code: 'markdown-renderer-runtime-load-failed', severity: 'warning' }],
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('rendered HTML extraction was retained'));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('preflight name'));
  });
});

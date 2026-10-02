import { expect, test, vi } from 'vitest';
import { loadRuntimeCorpusTokenizer } from './corpus-tokenizer.js';

test('memoizes runtime failures and exposes only a sanitized fallback reason', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(async () => { throw new Error('secret content'); });
  const loader = { module: './tokenizer.js', name: 'custom', version: '1', approximate: false, load };
  try {
    const first = await loadRuntimeCorpusTokenizer(loader);
    expect(first).toMatchObject({ implementation: { name: 'astro-aeo-approx', approximate: true }, fallback: 'preflight' });
    expect(await loadRuntimeCorpusTokenizer(loader)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(await loadRuntimeCorpusTokenizer(undefined)).not.toHaveProperty('fallback');
  } finally { warning.mockRestore(); }
});

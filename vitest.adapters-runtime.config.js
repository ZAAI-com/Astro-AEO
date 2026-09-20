import { defineConfig } from 'vitest/config';

// Node always runs. Cloudflare and Deno are selected explicitly by the test
// environment because their production runtimes are not present everywhere.
// runtime.test.js does its own per-runtime skipping. The static Cloudflare file has a
// single runtime, so it is selected here rather than booting workerd for an environment
// that never asked for it.
const selected = new Set(
  (process.env.ASTRO_AEO_ADAPTER_RUNTIMES ?? 'node,cloudflare,deno')
    .split(',')
    .map((name) => name.trim()),
);

export default defineConfig({
  test: {
    include: [
      'test/adapters/runtime.test.js',
      ...(selected.has('cloudflare') ? ['test/adapters/static-cloudflare.test.js'] : []),
    ],
    testTimeout: 180000,
    hookTimeout: 180000,
    maxWorkers: 1,
  },
});

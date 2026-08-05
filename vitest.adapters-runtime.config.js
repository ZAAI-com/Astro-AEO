import { defineConfig } from 'vitest/config';

// Node always runs. Cloudflare and Deno are selected explicitly by the test
// environment because their production runtimes are not present everywhere.
export default defineConfig({
  test: {
    include: ['test/adapters/runtime.test.js'],
    testTimeout: 180000,
    hookTimeout: 180000,
    maxWorkers: 1,
  },
});

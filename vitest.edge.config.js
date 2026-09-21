import { defineConfig } from 'vitest/config';

// The static edge handlers inside a real edge runtime. The pure contract suite runs
// in the default configuration; this one boots workerd through Wrangler, so it is
// opt-in like the adapter runtime suite.
export default defineConfig({
  test: {
    include: ['test/edge/**/*.test.js'],
    testTimeout: 180000,
    hookTimeout: 180000,
    maxWorkers: 1,
  },
});

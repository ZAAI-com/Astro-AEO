import { defineConfig } from 'vitest/config';

// Every adapter owns its fixture root and output directories. The five builds
// can therefore be release-gated without racing another Astro invocation.
export default defineConfig({
  test: {
    include: ['test/adapters/build.test.js'],
    testTimeout: 180000,
    hookTimeout: 180000,
    maxWorkers: 1,
  },
});

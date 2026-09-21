import { defineConfig } from 'vitest/config';

// Every recipe is a real Astro build, so this suite is opt-in like the adapter suites.
export default defineConfig({
  test: {
    include: ['test/recipes/**/*.test.js'],
    testTimeout: 300000,
    hookTimeout: 300000,
    maxWorkers: 1,
  },
});

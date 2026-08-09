import { defineConfig } from 'vitest/config';

// Opt-in, like the dev e2e: this builds and boots a real adapter server, so it is
// excluded from `pnpm test` and run by `pnpm run test:ssr`.
export default defineConfig({
  test: {
    include: ['src/**/*.ssr.test.js'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});

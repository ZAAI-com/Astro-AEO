import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are colocated next to the source they cover.
    include: ['src/**/*.test.{js,ts}', 'cli/**/*.test.{js,ts}'],
    // The dev-server e2e (*.dev.test.js) spawns `astro dev` and is opt-in via `test:dev`.
    exclude: ['**/*.dev.test.js', 'node_modules/**', 'fixtures/**'],
    // The build e2e spawns `astro build`, which is slower than the default timeouts.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});

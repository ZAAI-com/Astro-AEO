import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are colocated next to the source they cover.
    include: ['src/**/*.test.{js,ts}', 'cli/**/*.test.{js,ts}'],
    // The two e2e suites that boot a server are opt-in: *.dev.test.js spawns
    // `astro dev` (`test:dev`), *.ssr.test.js builds and boots an adapter server
    // (`test:ssr`). Both would also race the build e2e for a fixture root.
    exclude: ['**/*.dev.test.js', '**/*.ssr.test.js', 'node_modules/**', 'fixtures/**'],
    // The build e2e spawns `astro build`, which is slower than the default timeouts.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});

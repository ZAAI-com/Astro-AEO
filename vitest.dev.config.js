import { defineConfig } from 'vitest/config';

// Runs only the dev-server e2e (spawns `astro dev`). Kept separate from the
// default config so the slow, server-bound test is opt-in via `pnpm run test:dev`.
export default defineConfig({
  test: {
    include: ['src/hooks/server-setup.dev.test.js'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});

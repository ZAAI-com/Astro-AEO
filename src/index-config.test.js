import { describe, expect, test, vi } from 'vitest';
import aeo from './index.js';

describe('runtime configuration projection', () => {
  test('does not warn for build-only sitemap callbacks', async () => {
    const warnings = [];
    const integration = aeo({
      discovery: {
        sitemap: {
          mode: 'disabled',
          options: { filter: () => true, serialize: (item) => item },
        },
      },
    });

    await integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware: vi.fn(),
      updateConfig: vi.fn(),
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(warnings.join('\n')).not.toContain('discovery.sitemap.options');
  });

  test('still warns for callbacks used by the request-time pipeline', async () => {
    const warnings = [];
    const integration = aeo({
      corpus: {
        index: {
          sections: [{ title: 'Predicate', match: () => true }],
        },
      },
      discovery: { sitemap: { mode: 'disabled' } },
    });

    await integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware: vi.fn(),
      updateConfig: vi.fn(),
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(warnings.join('\n')).toContain('corpus.index.sections[0].match');
  });
});

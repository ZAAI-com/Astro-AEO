import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { writePrivateFile } from '../cli/indexnow-io.js';
import { INDEXNOW_PREPARE_PROVIDER, indexNowPaths } from './build/indexnow.js';
import { serializeIndexNowPrepareInput, sha256 } from './build/indexnow-state.js';
import aeo from './index.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

  test('exposes a non-enumerable config-mode IndexNow provider without secret resolution', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-config-indexnow-'));
    roots.push(root);
    const integration = aeo({
      discovery: {
        indexNow: {
          enabled: true,
          state: 'private',
          submit: 'all',
          key: { source: 'env', name: 'INDEXNOW_CONFIG_KEY' },
        },
      },
    });
    writePrivateFile(indexNowPaths(root).prepareInput, serializeIndexNowPrepareInput({
      version: 1,
      projectRoot: '/old-project',
      mode: 'public',
      submit: 'changed',
      strict: false,
      base: '',
      statePathname: '/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env' },
      origins: [{ origin: 'https://example.com', targetDigest: sha256('built') }],
      current: [{ url: 'https://example.com/', fingerprint: sha256('page') }],
    }));

    const provider = integration[INDEXNOW_PREPARE_PROVIDER];
    expect(Object.getOwnPropertyDescriptor(integration, INDEXNOW_PREPARE_PROVIDER)?.enumerable).toBe(false);
    expect(provider({ root, astroConfig: { base: '/docs' } })).toMatchObject({
      projectRoot: root,
      mode: 'private',
      submit: 'all',
      base: '/docs',
      statePathname: '/docs/.well-known/astro-aeo-indexnow-v1.json',
      key: { source: 'env', name: 'INDEXNOW_CONFIG_KEY' },
      origins: [{ origin: 'https://example.com', targetDigest: sha256('built') }],
    });
  });
});

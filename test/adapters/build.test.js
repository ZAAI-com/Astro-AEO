import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAdapter,
  emittedJavaScript,
  fixture,
  nonEmptyFile,
  readJson,
  unresolvedRelativeImports,
} from './helpers.js';

const serverEntryAdapters = ['node', 'cloudflare', 'deno'];

describe('adapter build gates', () => {
  test.each(['node', 'cloudflare', 'deno', 'vercel', 'netlify'])('%s builds successfully', (name) => {
    expect(() => buildAdapter(name)).not.toThrow();
  });

  test.each(serverEntryAdapters)('%s emits a complete server module graph', (name) => {
    const server = join(fixture(name), 'dist/server');
    expect(nonEmptyFile(join(server, 'entry.mjs'))).toBe(true);
    expect(nonEmptyFile(join(server, 'virtual_astro_middleware.mjs'))).toBe(true);
    expect(unresolvedRelativeImports(server)).toEqual([]);
  });

  test.each(serverEntryAdapters)('%s leaves runtime corpus paths out of static assets', (name) => {
    const client = join(fixture(name), 'dist/client');
    for (const path of ['llms.txt', 'llms-full.txt', 'docs/llms.txt', 'docs/llms-full.txt']) {
      expect(existsSync(join(client, path)), path).toBe(false);
    }
  });

  test('Cloudflare emits a workerd configuration and an edge-safe bundle', () => {
    const server = join(fixture('cloudflare'), 'dist/server');
    const config = readJson(join(server, 'wrangler.json'));
    expect(config.main).toBe('entry.mjs');
    expect(config.assets?.directory).toBe('../client');
    expect(config.compatibility_flags).toContain('nodejs_compat');

    const output = emittedJavaScript(server);
    expect(output).toContain('astro-aeo');
  });

  test.each(['cloudflare', 'deno'])('%s bundle boots without Turndown\'s CommonJS parser fallback', (name) => {
    const output = emittedJavaScript(join(fixture(name), 'dist/server'));
    expect(output).toContain('DOMParser');
    expect(output).not.toMatch(/require\(["']@mixmark-io\/domino["']\)/);
  });

  test('Vercel emits a Build Output API function with a valid handler', () => {
    const output = join(fixture('vercel'), '.vercel/output');
    const config = readJson(join(output, 'config.json'));
    const functionRoot = join(output, 'functions/_render.func');
    const functionConfig = readJson(join(functionRoot, '.vc-config.json'));
    expect(config.version).toBe(3);
    expect(config.routes).toEqual(expect.arrayContaining([expect.objectContaining({ dest: '_render' })]));
    expect(functionConfig.runtime).toMatch(/^nodejs/);
    expect(nonEmptyFile(join(functionRoot, functionConfig.handler))).toBe(true);
    expect(unresolvedRelativeImports(join(output, '_functions'))).toEqual([]);
  });

  test('Netlify emits its provider config and bundled SSR function', () => {
    const output = join(fixture('netlify'), '.netlify');
    expect(() => readJson(join(output, 'v1/config.json'))).not.toThrow();
    expect(nonEmptyFile(join(output, 'v1/functions/ssr/ssr.mjs'))).toBe(true);
    expect(unresolvedRelativeImports(join(output, 'build'))).toEqual([]);
  });

  test('Deno entrypoint does not reference Node-only package resolution', () => {
    const entry = readFileSync(join(fixture('deno'), 'dist/server/entry.mjs'), 'utf8');
    expect(entry).not.toMatch(/from ["']node:module["']/);
    expect(existsSync(join(fixture('deno'), 'dist/server/entry.mjs'))).toBe(true);
  });
});

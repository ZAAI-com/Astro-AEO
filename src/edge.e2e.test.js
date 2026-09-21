import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEdgeManifest } from './runtime/edge/handler.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO, 'fixtures', 'edge-static');
const DIST = join(FIXTURE, 'dist');
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);
let output;

beforeAll(() => {
  const result = spawnSync('node', [astroBin, 'build', '--root', FIXTURE], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, output).toBe(0);
});

describe('static edge negotiation build', () => {
  test('emits a manifest of exactly the companions the build wrote', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, '.well-known', 'astro-aeo-edge-v1.json'), 'utf8'));
    expect(manifest).toEqual({
      version: 1,
      provider: 'cloudflare',
      mode: 'response',
      base: '/',
      routes: [
        { html: '/', markdown: '/index.md' },
        { html: '/guide/', markdown: '/guide.md' },
      ],
    });
    expect(readEdgeManifest(manifest)).not.toBeNull();
    for (const route of manifest.routes) expect(existsSync(join(DIST, route.markdown))).toBe(true);
  });

  test('never advertises a companion a public file displaced', () => {
    expect(readFileSync(join(DIST, 'displaced.md'), 'utf8')).toBe('project-owned file\n');
    expect(readFileSync(join(DIST, '.well-known', 'astro-aeo-edge-v1.json'), 'utf8')).not.toContain('displaced');
  });

  test('does not warn that a project without an adapter cannot negotiate', () => {
    expect(output).not.toContain('has no adapter');
  });

  test('records the manifest in the ownership ledger with the bytes on disk', () => {
    const ownership = JSON.parse(readFileSync(join(FIXTURE, '.astro', 'aeo-cache', 'ownership-v1.json'), 'utf8'));
    const entry = ownership.artifacts.find((item) => item.pathname === '/.well-known/astro-aeo-edge-v1.json');
    expect(entry).toMatchObject({ status: 'emitted', owner: { kind: 'core', name: 'edgeManifest' } });
    expect(entry.representation.byteLength).toBe(statSync(join(DIST, '.well-known', 'astro-aeo-edge-v1.json')).size);
  });

  test('writes private deployment facts with no path and no secret', () => {
    const path = join(FIXTURE, '.astro', 'aeo-cache', 'deployment-v1.json');
    const text = readFileSync(path, 'utf8');
    expect(JSON.parse(text)).toMatchObject({
      version: 1,
      output: 'static',
      adapter: null,
      base: '/',
      buildFormat: 'directory',
      trailingSlash: 'ignore',
      negotiation: 'response',
      edgeProvider: 'cloudflare',
    });
    expect(text).not.toContain(REPO);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

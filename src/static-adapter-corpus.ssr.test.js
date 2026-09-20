import { test, expect, describe, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #8: a project whose page routes are all prerendered got no corpus at all
// once an adapter was installed. Astro-AEO injects `prerender: false` fallback
// routes for every adapter, Astro promotes the build to server output on the first
// such route, and the old ownership rule read that promotion back as proof that a
// server was required. Only a real build proves the files reach disk.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/static-adapter');
const CLIENT = join(FIXTURE, 'dist/client');

const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro,
);

let buildOutput = '';

beforeAll(() => {
  buildOutput = execFileSync('node', [astroBin, 'build', '--root', FIXTURE], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}, 180000);

describe('static output with an adapter', () => {
  test('reports server build output, because the injected fallbacks are on demand', () => {
    expect(existsSync(join(FIXTURE, 'dist/server/entry.mjs'))).toBe(true);
  });

  test.each(['llms.txt', 'llms-full.txt'])('emits %s next to the client assets', (name) => {
    const artifact = join(CLIENT, name);
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, 'utf8').trim().length).toBeGreaterThan(0);
  });

  test.each(['llms.txt', 'llms-full.txt'])('lists every getStaticPaths page in %s', (name) => {
    const contents = readFileSync(join(CLIENT, name), 'utf8');
    for (const pathname of ['/items/alpha', '/items/beta', '/about']) {
      expect(contents, `${name} is missing ${pathname}`).toContain(pathname);
    }
  });

  test('does not hand the corpus to request-time middleware', () => {
    expect(buildOutput).not.toContain('request-time middleware owns the configured corpus paths');
    expect(buildOutput).toContain('corpus artifact');
  });

  test('does not ask for a catalog the build does not need', () => {
    expect(buildOutput).not.toContain('request-time middleware owns the corpus');
    expect(buildOutput).not.toContain('pages.catalogs');
  });
});

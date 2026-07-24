import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNED = join(REPO, 'fixtures', 'sitemap-owned');
const FILTERED = join(REPO, 'fixtures', 'sitemap-filtered');

const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);

function build(root) {
  execFileSync('node', [astroBin, 'build', '--root', root], {
    cwd: REPO,
    stdio: 'ignore',
  });
}

beforeAll(() => {
  build(OWNED);
  build(FILTERED);
});

describe('sitemap build finalization', () => {
  test('preserves an endpoint-owned alias with a user-registered custom sitemap', () => {
    const dist = join(OWNED, 'dist');

    expect(existsSync(join(dist, 'custom-index.xml'))).toBe(true);
    expect(existsSync(join(dist, 'custom-0.xml'))).toBe(true);
    expect(existsSync(join(dist, 'sitemap-index.xml'))).toBe(false);
    expect(readFileSync(join(dist, 'sitemap.xml'), 'utf8')).toBe('<owned-sitemap/>');
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://owned.example.com/custom-index.xml',
    );
  });

  test('does not advertise a sitemap when generation filters out every page', () => {
    const dist = join(FILTERED, 'dist');

    expect(existsSync(join(dist, 'sitemap-index.xml'))).toBe(false);
    expect(existsSync(join(dist, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
  });
});

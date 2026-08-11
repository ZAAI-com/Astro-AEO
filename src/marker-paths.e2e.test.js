import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO, 'fixtures', 'marker-paths');
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

describe('marker path and dynamic collision build', () => {
  test('removes authored-source markers from file-format and status pages', () => {
    for (const file of ['about.html', '404.html', '500.html']) {
      const html = readFileSync(join(DIST, file), 'utf8');
      expect(html).not.toContain('data-astro-aeo-marker');
      expect(html).not.toContain('Private source');
      expect(html).not.toContain('fixture:');
    }
  });

  test('preserves a generated dynamic endpoint on an artifact collision', () => {
    expect(output).toContain('/about.md is owned by a project route');
    expect(readFileSync(join(DIST, 'about.md'), 'utf8')).toBe(
      'project-owned dynamic endpoint\n',
    );
  });
});

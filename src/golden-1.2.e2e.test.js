import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/golden-1.2');
const HTML_PATH = join(FIXTURE, 'dist/index.html');
const EXPECTED = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));
const astroPackage = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(
  REPO,
  'node_modules/astro',
  typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro,
);

describe('the 1.2 semantic golden output', () => {
  beforeAll(() => {
    execFileSync('node', [astroBin, 'build', '--root', FIXTURE], {
      cwd: REPO,
      stdio: 'ignore',
    });
  });

  test('injects the default managed graph with stable canonical IDs', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const managed = html.match(
      /<script type="application\/ld\+json" data-astro-aeo-graph>([\s\S]*?)<\/script>/,
    );
    expect(managed?.[1]).toBe(EXPECTED.managedScript);
    expect(html.match(/data-astro-aeo-graph/g)).toHaveLength(1);
    expect(html).not.toContain('data-astro-aeo-head');
  });

  test('keeps all six legacy component payloads byte-identical', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const authored = [...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    )].map((match) => match[1]);
    expect(authored).toEqual(EXPECTED.authoredScripts);
  });
});

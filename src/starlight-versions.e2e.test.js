import { beforeAll, expect, test, describe } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = join(repo, 'fixtures/starlight-versions-static');
const astroDir = join(repo, 'node_modules/astro');
const astro = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
const supported = Number(astro.version.split('.')[0]) >= 7;
const read = (pathname) => readFileSync(join(root, 'dist', pathname), 'utf8');

beforeAll(() => {
  if (!supported) return;
  const result = spawnSync(process.execPath, [join(astroDir, typeof astro.bin === 'string' ? astro.bin : astro.bin.astro), 'build', '--root', root],
    { cwd: repo, encoding: 'utf8' });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

describe.skipIf(!supported)('multilingual Starlight version build', () => {
  test('populates current and interprets an explicitly configured archive prefix', () => {
    const manifest = JSON.parse(read('llms/manifest.json'));
    expect(manifest.versions).toEqual({ current: 'v2', order: ['v2', 'v1'] });
    const current = manifest.pages.find((page) => page.id === '/en/guides/install');
    const archive = manifest.pages.find((page) => page.id === '/en/release-1/guides/install');
    expect(current.versionGroup).toBe('/guides/install');
    expect(archive.versionGroup).toBe(current.versionGroup);
    expect(current.versionAlternates).toEqual([{ kind: 'version', version: 'v1', url: archive.canonicalUrl }]);
    expect(archive.versionAlternates).toEqual([{ kind: 'version', version: 'v2', url: current.canonicalUrl }]);
    expect(read('en/v1/llms-full.txt')).toContain('Legacy English install.');
    expect(read('en/v1/llms-full.txt')).not.toContain('Current English install.');
    expect(read('en/guides/install.md')).toContain('- Version v1: <https://starlight-versions.example.test/docs/en/release-1/guides/install/>');
    expect(read('en/guides/install.md')).toContain('- Source: <https://example.test/blob/main/src/content/docs/en/guides/install.md>');
    expect(read('en/guides/install.md')).not.toContain('Edit this page');
  });

  test('excludes untranslated fallback records even when an authored AeoPage wins', () => {
    const manifest = JSON.parse(read('llms/manifest.json'));
    expect(manifest.pages.some((page) => page.id === '/fr/release-1/guides/install' || page.id === '/fr/guides/fallback')).toBe(false);
    expect(manifest.pages.some((page) => page.id === '/en/guides/fallback')).toBe(true);
    expect(read('fr/llms-full.txt')).not.toContain('Legacy English install.');
    expect(read('fr/llms-full.txt')).not.toContain('Untranslated authored source.');
    expect(read('fr/guides/fallback.md')).toContain('Untranslated authored source.');
    const diagnostics = JSON.parse(readFileSync(join(root, '.astro/aeo-cache/diagnostics-v1.json'), 'utf8'));
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({ code: 'starlight-fallback-locale-excluded', pathname: '/fr/guides/fallback' }));
    expect(read('fr/guides/fallback/index.html')).not.toContain('data-astro-aeo-marker');
  });
});

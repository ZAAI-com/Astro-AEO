import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO, 'fixtures', 'starlight-static');
const DIST = join(FIXTURE, 'dist');
const astroDir = join(REPO, 'node_modules', 'astro');
const astroPackage = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
const astroBinField = astroPackage.bin;
// The pinned Starlight needs Astro 7, so the Astro 5 and 6 matrix jobs skip this file.
const SUPPORTED = Number(astroPackage.version.split('.')[0]) >= 7;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);
const read = (file) => readFileSync(join(DIST, file), 'utf8');
let output;

beforeAll(() => {
  if (!SUPPORTED) return;
  const result = spawnSync('node', [astroBin, 'build', '--root', FIXTURE], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, output).toBe(0);
});

function htmlFiles(directory = DIST) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith('.html') ? [path] : [];
  });
}

describe.skipIf(!SUPPORTED)('Starlight plugin build', () => {
  test('publishes the authored source with asides as labeled sections', () => {
    const markdown = read('guides/install.md');
    expect(markdown).toContain('# Install');
    expect(markdown).toContain('> **Caution: Back up first**');
    expect(markdown).toContain('> The installer rewrites `config.json`.');
    // A directive inside a code fence is code.
    expect(markdown).toContain('```sh\n:::note\nthis fence is code, not an aside\n:::\n```');
  });

  test('turns tabs and the Aside component into labeled sections and drops MDX imports', () => {
    const markdown = read('guides/tabs.md');
    expect(markdown).toContain('**npm**');
    expect(markdown).toContain('Run `pnpm add fixture`.');
    expect(markdown).toContain('> **Tip: Lockfiles**');
    expect(markdown).not.toContain('import ');
    expect(markdown).not.toContain('<Tab');
  });

  test('appends pagination by default and the edit link when asked', () => {
    const markdown = read('guides/install.md');
    expect(markdown).toContain('- Next: [Package managers](/guides/tabs/)');
    expect(markdown).toContain('- Edit this page: <https://example.com/edit/src/content/docs/guides/install.md>');
  });

  test('falls back to the rendered content for MDX it cannot convert, and records why', () => {
    const markdown = read('guides/dynamic.md');
    expect(markdown).toContain('The rendered year is 2026.');
    expect(markdown).not.toContain('export const');
    // Extraction is scoped to the content region, so the sidebar is not part of the companion.
    expect(markdown).not.toContain('Package managers');
    const manifest = JSON.parse(readFileSync(join(FIXTURE, '.astro', 'aeo-cache', 'diagnostics-v1.json'), 'utf8'));
    const page = manifest.pages.find((entry) => entry.pathname === '/guides/dynamic');
    expect(page.diagnostics).toEqual([expect.objectContaining({ code: 'authored-source-fallback', severity: 'info' })]);
  });

  test('an explicit AeoPage wins over the inferred marker', () => {
    const markdown = read('guides/explicit.md');
    expect(markdown).toContain('# Authored wins');
    expect(markdown).not.toContain('This rendered paragraph');
  });

  test('ships no marker and no page source in any HTML file', () => {
    const files = htmlFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      expect(html).not.toContain('data-astro-aeo-marker');
      expect(html).not.toContain('application/vnd.astro-aeo+json');
    }
  });

  test('leaves the sitemap to Starlight and lists the docs in llms.txt', () => {
    expect(output).not.toMatch(/sitemap.*(twice|duplicate)/i);
    const llms = read('llms.txt');
    expect(llms).toContain('/guides/install');
    expect(llms).not.toContain('/404');
  });
});

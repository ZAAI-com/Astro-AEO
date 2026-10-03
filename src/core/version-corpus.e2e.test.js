import { afterAll, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
mkdirSync(join(repo, '.astro'), { recursive: true });
const root = mkdtempSync(join(repo, '.astro', 'version-topology-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function write(pathname, contents) {
  const target = join(root, pathname);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

test('Astro builds reciprocal locale/version corpora under a base without moving companions', async () => {
  write('package.json', '{"type":"module"}\n');
  write('astro.config.mjs', `
import { defineConfig } from 'astro/config';
import aeo from 'astro-aeo';
export default defineConfig({
  site: 'https://versions.example.test', base: '/docs',
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en', routing: { prefixDefaultLocale: true } },
  integrations: [aeo({
    markdown: { includeLastModified: false }, i18n: { indexes: 'both' },
    corpus: { versions: { current: 'v2', order: ['v1'] }, manifest: { enabled: true },
      chunks: { enabled: true }, compression: { gzip: true } },
    discovery: { sitemap: { mode: 'disabled' } },
  })],
});
`);
  for (const locale of ['en', 'fr']) for (const version of ['v2', 'v1']) {
    write(`src/pages/${locale}/${version === 'v1' ? 'v1/' : ''}guide.astro`, `
---
import { AeoPage } from 'astro-aeo/components';
---
<html lang="${locale}"><head><title>${version} ${locale}</title></head><body>
  <AeoPage markdown="# ${version} ${locale}\n\nAuthored guide." versionGroup="guide" ${version === 'v1' ? 'version="v1"' : ''} />
  <main><h1>${version} ${locale}</h1><p>Rendered fallback.</p></main>
</body></html>
`);
  }
  const astroDir = join(repo, 'node_modules', 'astro');
  const { bin } = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
  const env = { ...process.env, ASTRO_DEV_BACKGROUND: '1' };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) if (/^(?:VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  const child = spawn(process.execPath, [join(astroDir, typeof bin === 'string' ? bin : bin.astro), 'build', '--root', root],
    { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const [code] = await once(child, 'exit');
  expect(code, output).toBe(0);
  const read = (pathname) => readFileSync(join(root, 'dist', pathname), 'utf8');
  const aggregate = JSON.parse(read('llms/manifest.json'));
  const archive = JSON.parse(read('v1/llms/manifest.json'));
  expect(aggregate.pages).toHaveLength(4);
  expect(aggregate.versions).toEqual({ current: 'v2', order: ['v2', 'v1'] });
  expect(archive.pages).toHaveLength(2);
  expect(archive.pages.every((page) => page.version === 'v1')).toBe(true);
  for (const page of aggregate.pages) {
    expect(page.versionAlternates).toHaveLength(1);
    const alternate = page.versionAlternates[0];
    const target = aggregate.pages.find((peer) => peer.canonicalUrl === alternate.url);
    expect(target.locale).toBe(page.locale);
    expect(target.versionAlternates).toContainEqual({ kind: 'version', version: page.version, url: page.canonicalUrl });
  }
  expect(read('fr/v1/llms-full.txt')).toContain('# v1 fr');
  expect(read('fr/v1/llms-full.txt')).not.toContain('# v2 fr');
  expect(read('fr/llms-full.txt')).toContain('# v2 fr');
  expect(read('v1/llms-fr.txt')).toBe(read('fr/v1/llms.txt'));
  expect(gunzipSync(readFileSync(join(root, 'dist/fr/v1/llms-full.txt.gz'))).toString()).toBe(read('fr/v1/llms-full.txt'));
  expect(aggregate.artifacts).toContainEqual(expect.objectContaining({ pathname: '/docs/fr/v1/llms-full.txt', version: 'v1' }));
  expect(read('fr/v1/guide.md')).toContain('# v1 fr');
  expect(read('fr/v1/guide/index.html')).not.toMatch(/data-astro-aeo-marker|astro-aeo\+json|type="module"/);
});

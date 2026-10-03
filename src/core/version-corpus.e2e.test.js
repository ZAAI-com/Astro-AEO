import { afterAll, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../../cli/doctor.js';
import { runReport } from '../../cli/report.js';
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
      rag: { enabled: true, publish: true, maxTokens: 8 }, chunks: { enabled: true }, compression: { gzip: true } },
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
  const rag = read('fr/v1/llms/rag.jsonl');
  expect(gunzipSync(readFileSync(join(root, 'dist/fr/v1/llms/rag.jsonl.gz'))).toString()).toBe(rag);
  expect(rag.trim().split('\n').map((line) => JSON.parse(line)).every((record) => record.metadata.locale === 'fr' && record.metadata.contentVersion === 'v1')).toBe(true);
  expect(aggregate.artifacts).toContainEqual(expect.objectContaining({ pathname: '/docs/fr/v1/llms/rag.jsonl', kind: 'rag', version: 'v1' }));
  const cache = join(root, '.astro', 'aeo-cache');
  const index = JSON.parse(readFileSync(join(cache, 'rag-v1', 'index-v1.json'), 'utf8'));
  const snapshot = JSON.parse(readFileSync(join(cache, 'pages-v1.json'), 'utf8'));
  expect(index.buildDigest).toBe(snapshot.buildDigest);
  expect(index).toMatchObject({inventoryComplete:true,buildTimeIncomplete:false});
  expect(index.files).toHaveLength(4);
  for (const entry of index.files) expect(lstatSync(join(cache,'rag-v1',entry.file)).mode & 0o777).toBe(0o600);
  expect(read('fr/v1/guide.md')).toContain('# v1 fr');
  expect(read('fr/v1/guide/index.html')).not.toMatch(/data-astro-aeo-marker|astro-aeo\+json|type="module"/);
  const inspected = await runReport(['inspect','--format','json'],{cwd:root});
  expect(inspected.warnings).toEqual([]);
  const doctor = await runDoctor([root]);
  expect(doctor.checks.find((check) => check.id === 'build-evidence')?.status).toBe('unverified');
  expect(inspected.report.pages).toHaveLength(4);
  expect(inspected.report.pages.every((entry) => entry.trace && entry.companions.length === 1)).toBe(true);
  const privateExport = await runReport(['rag','--format','json'],{cwd:root});
  expect(privateExport.report.source).toBe('private');
  expect(privateExport.report.inventoryComplete).toBe(true);
  expect(privateExport.report.buildTimeIncomplete).toBe(false);
  expect(privateExport.warnings).toEqual([]);
  const unchanged = await runReport(['changes','--baseline',join(root,'.astro/aeo-cache/pages-v1.json'),'--fail-on','any'],{cwd:root});
  expect(unchanged.exitCode).toBe(0);
  expect(unchanged.report.pages).toEqual([]);
  rmSync(join(root,'.astro','aeo-cache','rag-v1'),{recursive:true});
  const companionsExport = await runReport(['rag','--format','json','--max-tokens','8'],{cwd:root});
  expect(companionsExport.report.source).toBe('companions');
  expect(companionsExport.report.records.filter((entry) => entry.kind === 'page')).toHaveLength(4);
  expect(companionsExport.report.records.every((entry) => ['v1','v2'].includes(entry.metadata.contentVersion))).toBe(true);
  expect(companionsExport.warnings).not.toContain('A companion differs from its manifest content hash.');
});

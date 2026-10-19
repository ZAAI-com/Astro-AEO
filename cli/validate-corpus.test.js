import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { planCorpusArtifacts } from '../src/core/corpus-artifacts.js';
import { createLocaleSnapshot } from '../src/core/locale.js';
import { renderMarkdownDocument } from '../src/core/render/markdown-doc.js';
import { validateCorpusArtifacts } from './validate-corpus.js';

const origin = 'https://example.test';
const page = (locale, version) => {
  const pathname = `/${locale}/${version ? `${version}/` : ''}guide`;
  return { id: pathname, pathname, ...(version ? { version } : {}), locale, language: locale,
    origin, url: `${origin}${pathname}/`, mdHref: `${pathname}.md`,
    title: 'guide', description: '', markdown: `# ${version ?? 'current'} ${locale}\n\nContent.`,
    aeoTokens: [], directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    source: { strategy: 'marker' }, rendering: 'prerendered' };
};
/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const pages = [page('en'), page('en', 'v1'), page('fr'), page('fr', 'v1')];
const config = resolveConfig({ i18n: { indexes: 'locale' }, corpus: { versions: { current: 'v2', order: ['v1'] },
  manifest: { enabled: true }, chunks: { enabled: true } } });

/** Write a complete versioned build: artifacts, companions and the aggregate manifest. */
async function versionedDist(mutate = (manifest) => manifest) {
  const build = await planCorpusArtifacts({
    pages, config, i18n: createLocaleSnapshot({ locales: ['en', 'fr'], defaultLocale: 'en' }, origin),
    origin, base: '/', siteMeta: { name: 'Docs', description: '' },
  });
  const dist = mkdtempSync(join(tmpdir(), 'aeo-validate-versions-')); roots.push(dist);
  const write = (pathname, contents) => {
    const file = join(dist, pathname); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents);
  };
  for (const artifact of build.artifacts) write(artifact.pathname, artifact.contents);
  for (const source of pages) write(source.mdHref, renderMarkdownDocument(source, config));
  write('/llms/manifest.json', `${JSON.stringify(mutate(structuredClone(build.manifest)), null, 2)}\n`);
  const out = { errors: [], warnings: [] };
  validateCorpusArtifacts(dist, '', out);
  return { build, out };
}

test('a versioned manifest with one locale record per version validates cleanly', async () => {
  const { build, out } = await versionedDist();
  expect(build.manifest.locales.filter((record) => record.locale === 'fr')).toHaveLength(2);
  expect(build.manifest.pages.some((record) => record.chunks.length > 0)).toBe(true);
  expect(out.errors).toEqual([]);
});

test('rejects a canonical artifact or chunk from another version', async () => {
  const canonical = await versionedDist((manifest) => {
    const archive = manifest.locales.find((record) => record.locale === 'fr' && record.version === 'v1');
    archive.canonicalArtifact = manifest.locales.find((record) => record.locale === 'fr' && record.version === 'v2').canonicalArtifact;
    return manifest;
  });
  expect(canonical.out.errors.map((finding) => finding.code)).toContain('corpus-locale-canonical-missing');
  const chunk = await versionedDist((manifest) => {
    const current = manifest.pages.find((record) => record.locale === 'fr' && record.version === 'v2');
    current.chunks = manifest.pages.find((record) => record.locale === 'fr' && record.version === 'v1').chunks;
    return manifest;
  });
  expect(chunk.out.errors.map((finding) => finding.code)).toContain('corpus-page-chunk-metadata');
});

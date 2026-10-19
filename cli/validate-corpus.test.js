import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { planCorpusArtifacts } from '../src/core/corpus-artifacts.js';
import { createLocaleSnapshot } from '../src/core/locale.js';
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

test('a versioned manifest with one locale record per version validates without locale errors', async () => {
  const build = await planCorpusArtifacts({
    pages: [page('en'), page('en', 'v1'), page('fr'), page('fr', 'v1')],
    config: resolveConfig({ i18n: { indexes: 'locale' }, corpus: { versions: { current: 'v2', order: ['v1'] }, manifest: { enabled: true } } }),
    i18n: createLocaleSnapshot({ locales: ['en', 'fr'], defaultLocale: 'en' }, origin),
    origin, base: '/', siteMeta: { name: 'Docs', description: '' },
  });
  const dist = mkdtempSync(join(tmpdir(), 'aeo-validate-versions-')); roots.push(dist);
  const write = (pathname, contents) => {
    const file = join(dist, pathname); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents);
  };
  for (const artifact of build.artifacts) write(artifact.pathname, artifact.contents);
  write('/llms/manifest.json', build.manifestText);
  expect(build.manifest.locales.filter((record) => record.locale === 'fr')).toHaveLength(2);
  const out = { errors: [], warnings: [] };
  validateCorpusArtifacts(dist, '/', out);
  expect(out.errors.filter((finding) => /^corpus-(locale|page-locale)/.test(finding.code))).toEqual([]);
});

import { expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { planCorpusArtifacts } from './corpus-artifacts.js';
import { createLocaleSnapshot } from './locale.js';
import { isPotentialCorpusArtifactPath } from './corpus-topology.js';

const origin = 'https://example.test';
const i18n = createLocaleSnapshot({ locales: ['en', 'fr'], defaultLocale: 'en' }, origin);
const page = (locale, version, leaf = 'guide') => {
  const pathname = `/${locale}/${version ? `${version}/` : ''}${leaf}`;
  return { id: pathname, pathname, ...(version ? { version } : {}), locale, language: locale,
    origin, url: `${origin}/docs${pathname}/`, mdHref: `/docs${pathname}.md`,
    title: leaf, description: '', markdown: `# ${version ?? 'current'} ${locale}\n\nContent.`,
    aeoTokens: [], directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    source: { strategy: 'marker' }, rendering: 'prerendered' };
};
const input = (indexes = 'both', extra = {}) => ({
  pages: [page('en'), page('en', 'v1'), page('fr'), page('fr', 'v1')],
  config: resolveConfig({ i18n: { indexes }, corpus: { versions: { current: 'v2', order: ['v1'] },
    manifest: { enabled: true }, chunks: { enabled: true }, small: { enabled: true } } }),
  i18n, origin, base: '/docs', siteMeta: { name: 'Docs', description: '' }, ...extra,
});

test.each(['auto', 'global', 'locale', 'both'])('plans %s versions with reciprocal records and base/locale archive paths', async (mode) => {
  const request = input(mode);
  const build = await planCorpusArtifacts(request);
  expect(build.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  expect(build.manifest.versions).toEqual({ current: 'v2', order: ['v2', 'v1'] });
  expect(build.manifest.pages).toHaveLength(4);
  expect(build.manifest.pages.every((record) => record.versionAlternates.length === 1)).toBe(true);
  for (const artifact of build.artifacts) expect(isPotentialCorpusArtifactPath(artifact.pathname, request.config), artifact.pathname).toBe(true);
  const archive = build.manifests[0];
  expect(archive.pathname).toBe('/v1/llms/manifest.json');
  expect(archive.manifest.pages.every((record) => record.version === 'v1')).toBe(true);
  const current = build.artifacts.filter((record) => record.version === 'v2');
  expect(current.every((record) => !record.pathname.includes('/v2/'))).toBe(true);
  if (mode !== 'global') {
    expect(build.artifacts.find((record) => record.pathname === '/fr/v1/llms.txt').contents).toContain('v1');
    expect(build.manifest.locales).toContainEqual(expect.objectContaining({ locale: 'fr', version: 'v1', canonicalArtifact: '/docs/fr/v1/llms.txt' }));
  }
  if (mode === 'both') expect(build.artifacts.find((record) => record.pathname === '/v1/llms-fr.txt')).toMatchObject({
    sourcePathname: '/fr/v1/llms.txt', kind: 'alias',
  });
  if (mode === 'auto' || mode === 'both') expect(build.artifacts.find((record) => record.pathname === '/v1/llms.txt').contents)
    .toContain('/docs/fr/v1/llms.txt');
  const runtime = await planCorpusArtifacts({ ...request, requestTime: true });
  expect(runtime).toEqual(build);
});

test('a tokenizer count failure restarts every version with one approximation identity', async () => {
  const request = input();
  const normal = await planCorpusArtifacts(request);
  const failed = await planCorpusArtifacts({ ...request, tokenizerProbed: true, tokenizer: {
    apiVersion: 1, name: 'exact', version: '1', approximate: false,
    count(text) { if (text.includes('# v1')) throw new Error('secret diagnostic'); return text.length; },
  } });
  expect(failed.manifest.tokenizer).toEqual(normal.manifest.tokenizer);
  expect(failed.manifest.tokenizerFallback).toEqual({ reason: 'count' });
  expect(failed.artifacts).toEqual(normal.artifacts);
  expect(failed.manifests.every((record) => record.manifest.tokenizerFallback.reason === 'count')).toBe(true);
  expect(failed.manifestText).not.toContain('secret diagnostic');
});

test('does not change topology per version when one locale only exists in the archive', async () => {
  const request = input('auto', { pages: [page('en'), page('fr', 'v1')] });
  const plan = await planCorpusArtifacts(request);
  expect(plan.artifacts.find((record) => record.pathname === '/en/llms.txt')).toBeTruthy();
  expect(plan.artifacts.find((record) => record.pathname === '/fr/v1/llms.txt')).toBeTruthy();
  expect(plan.artifacts.find((record) => record.pathname === '/llms.txt').contents).not.toContain('/fr/llms.txt');
});

test('does not require a nonempty current inventory to publish archive manifests', async () => {
  const plan = await planCorpusArtifacts(input('both', { pages: [page('fr', 'v1')] }));
  expect(plan.diagnostics.filter((record) => record.severity === 'error')).toEqual([]);
  expect(plan.manifest.pages).toHaveLength(1);
});

test('an empty build-time version inventory can defer manifests to live collection', async () => {
  const plan = await planCorpusArtifacts(input('both', { pages: [], deferEmptyManifest: true }));
  expect(plan.diagnostics).toEqual([]);
  expect(plan.manifest).toBeUndefined();
  const staticPlan = await planCorpusArtifacts(input('both', { pages: [] }));
  expect(staticPlan.diagnostics).toContainEqual(expect.objectContaining({ code: 'corpus-manifest-canonical-missing', severity: 'error' }));
});

import { expect, test } from 'vitest';
import { createLocaleSnapshot } from './locale.js';
import { normalizeVersionPages, versionPageIdentity } from './version-pages.js';

const versions = { current: 'v2', order: ['v1'] };
const i18n = createLocaleSnapshot({ locales: ['en', 'fr'], defaultLocale: 'en' }, 'https://example.test');
const page = (pathname, version, locale = 'en', extra = {}) => ({
  pathname, id: pathname, version, locale, url: `https://example.test/docs${pathname}/`, ...extra,
});

test('matches reciprocal versions within one locale, assigning unlabelled current pages', () => {
  const input = [page('/en/guide', undefined), page('/en/v1/guide', 'v1'),
    page('/fr/guide', undefined, 'fr'), page('/fr/v1/guide', 'v1', 'fr')];
  const result = normalizeVersionPages(input, versions, { i18n, base: '/docs' });
  expect(result.diagnostics).toEqual([]);
  for (const record of result.pages) {
    expect(record.alternates).toHaveLength(1);
    const alternate = record.alternates[0];
    expect(alternate.kind).toBe('version');
    const target = result.pages.find((candidate) => candidate.url === alternate.url);
    expect(target.locale).toBe(record.locale);
    expect(target.alternates).toEqual([{ kind: 'version', version: record.version, url: record.url }]);
  }
  expect(result.pages[0].version).toBe('v2');
  expect(input[0].version).toBeUndefined();
});

test('removes only configured base, locale and the matching version prefix', () => {
  expect(versionPageIdentity(page('/v1/en/guide', 'v1'), { i18n, base: '/docs' })).toBe('/guide');
  expect(versionPageIdentity(page('/en/v1/en/guide', 'v1'), { i18n, base: '/docs' })).toBe('/en/guide');
  expect(versionPageIdentity(page('/en/v1/guide', 'v1'), { i18n, base: '/docs' })).toBe('/guide');
  expect(versionPageIdentity(page('/en/v0/guide', 'v1'), { i18n, base: '/docs' })).toBe('/v0/guide');
  expect(versionPageIdentity(page('/other/v1/guide', 'v1'), { i18n, base: '/docs' })).toBe('/other/v1/guide');
  expect(versionPageIdentity(page('/en/guide/v1', 'v1'), { i18n, base: '/docs' })).toBe('/guide/v1');
  expect(versionPageIdentity(page('/en/docs/v1/guide', 'v1'), { i18n, base: '/docs' })).toBe('/docs/v1/guide');
});

test('authored versionGroup bridges different routes and keeps language alternatives', () => {
  const languages = [{ language: 'fr', url: 'https://example.test/fr/guide/' }];
  const input = [page('/en/new-name', 'v2', 'en', { versionGroup: 'guide', alternates: languages }),
    page('/en/v1/old-name', 'v1', 'en', { versionGroup: 'guide' })];
  const result = normalizeVersionPages(input, versions, { i18n, base: '/docs' });
  expect(result.diagnostics).toEqual([]);
  expect(result.pages[0].alternates[0]).toBe(languages[0]);
  expect(result.pages[0].alternates[1].url).toBe(input[1].url);
});

test('fails ambiguous groups and conflicting authored version alternatives closed', () => {
  const ambiguous = normalizeVersionPages([page('/a', 'v2', 'en', { versionGroup: 'same' }),
    page('/b', 'v2', 'en', { versionGroup: 'same' }), page('/v1/a', 'v1', 'en', { versionGroup: 'same' })], versions);
  expect(ambiguous.diagnostics.every((entry) => entry.code === 'version-group-ambiguous')).toBe(true);
  expect(ambiguous.pages.every((entry) => entry.alternates.length === 0)).toBe(true);
  const conflict = normalizeVersionPages([page('/en/guide', 'v2', 'en', {
    alternates: [{ kind: 'version', version: 'v1', url: 'https://wrong.test/' }],
  }), page('/en/v1/guide', 'v1')], versions, { i18n, base: '/docs' });
  expect(conflict.diagnostics[0].code).toBe('version-alternate-conflict');
});

test('recomputes generated links after inventory exclusions without treating them as authored claims', () => {
  const first = normalizeVersionPages([page('/en/guide', 'v2'), page('/en/v1/guide', 'v1')], versions, { i18n, base: '/docs' });
  const second = normalizeVersionPages([first.pages[0]], versions, { i18n, base: '/docs' });
  expect(second.diagnostics).toEqual([]);
  expect(second.pages[0].alternates).toEqual([]);
});

test('metadata-only labels remain unchanged without opt-in and invalid current versions fail closed', () => {
  const input = [page('/guide', 'v1')];
  expect(normalizeVersionPages(input, undefined).pages).toBe(input);
  expect(normalizeVersionPages(input, { current: '../bad', order: [] }).diagnostics[0].code).toBe('corpus-version-current-required');
  expect(normalizeVersionPages([page('/doc', 'v2', 'en', { versionGroup: '\u0000invalid' })], versions)
    .diagnostics[0].code).toBe('page-version-group-invalid');
});

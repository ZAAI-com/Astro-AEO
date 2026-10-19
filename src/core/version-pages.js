// @ts-check
import { isPageVersion, isVersionGroup } from './page-version.js';
import { inspectRootPathname } from './match.js';
import { corpusVersions } from './corpus-topology.js';

/** Explicit logical cross-version identity. Never strip an arbitrary segment.
 * @param {any} page @param {{ base?: string; i18n?: import('./locale.js').LocaleSnapshot }} site
 */
export function versionPageIdentity(page, site = {}) {
  if (typeof page.versionGroup === 'string' && page.versionGroup.trim()) return page.versionGroup;
  let pathname = page.pathname;
  try { if (typeof page.url === 'string') pathname = new URL(page.url).pathname; } catch {}
  let path = inspectRootPathname(pathname)?.decoded ?? pathname;
  const rawBase = (site.base ?? '').replace(/\/$/, '');
  const base = rawBase ? inspectRootPathname(rawBase)?.decoded ?? rawBase : '';
  if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length) || '/';
  const locale = site.i18n?.locales.find((entry) => entry.locale === page.locale)?.path;
  let localeRemoved = false;
  let versionRemoved = false;
  for (let step = 0; step < 2; step++) {
    if (locale && !localeRemoved && (path === `/${locale}` || path.startsWith(`/${locale}/`))) {
      path = path.slice(locale.length + 1) || '/'; localeRemoved = true;
    }
    if (isPageVersion(page.version) && !versionRemoved &&
        (path === `/${page.version}` || path.startsWith(`/${page.version}/`))) {
      path = path.slice(page.version.length + 1) || '/'; versionRemoved = true;
    }
  }
  return path.replace(/\/+$/, '') || '/';
}

/** Assign current labels and emit reciprocal version alternatives within a locale.
 * Authored language alternatives are retained byte-for-byte. Ambiguous groups
 * fail closed, rather than guessing a canonical or generating asymmetric links.
 * @template T
 * @param {T[]} input @param {import('../index.js').ResolvedCorpusVersions | undefined} versions
 * @param {{ base?: string; i18n?: import('./locale.js').LocaleSnapshot }} [site]
 * @returns {{ pages: T[]; diagnostics: import('../index.js').Diagnostic[] }}
 */
export function normalizeVersionPages(input, versions, site = {}) {
  if (!versions) return { pages: input, diagnostics: [] };
  if (!isPageVersion(versions.current)) return { pages: input, diagnostics: [{ version: 1,
    code: 'corpus-version-current-required', severity: 'error', message: 'Versioned corpora require a valid current version.' }] };
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];
  /** @type {Map<string, Map<string, any[]>>} */
  const groups = new Map();
  const pages = input.map((item) => {
    const page = /** @type {any} */ (item);
    return { ...page, version: page.version ?? versions.current };
  });
  const order = corpusVersions(pages, versions);
  for (const page of pages) {
    if (!isPageVersion(page.version)) { report('page-version-invalid', page); continue; }
    if (page.versionGroup !== undefined && !isVersionGroup(page.versionGroup)) { report('page-version-group-invalid', page); continue; }
    if (page.corpusExcluded) continue;
    const key = JSON.stringify([page.locale ?? null, versionPageIdentity(page, site)]);
    const group = groups.get(key) ?? new Map();
    const members = group.get(page.version) ?? [];
    members.push(page); group.set(page.version, members); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const ambiguous = [...group.values()].some((members) => members.length > 1);
    for (const members of group.values()) for (const page of members) {
      const authored = (page.alternates ?? []).filter((/** @type {any} */ alternate) => alternate?.kind === 'version' &&
        !(page._generatedVersionAlternates ?? []).some((/** @type {any} */ generated) =>
          generated.version === alternate.version && generated.url === alternate.url));
      const expected = ambiguous ? [] : order.flatMap((version) => {
        const target = group.get(version)?.[0];
        if (!target || target === page) return [];
        const url = safeUrl(target.canonicalUrl ?? target.url);
        return url ? [{ kind: /** @type {const} */ ('version'), version, url }] : [];
      });
      if (ambiguous) report('version-group-ambiguous', page);
      for (const alternate of authored) {
        if (!expected.some((candidate) => candidate.version === alternate.version && candidate.url === alternate.url)) {
          report('version-alternate-conflict', page);
        }
      }
      page._generatedVersionAlternates = expected;
      page.alternates = [...(page.alternates ?? []).filter((/** @type {any} */ alternate) => alternate?.kind !== 'version'), ...expected];
    }
  }
  return { pages: /** @type {T[]} */ (pages), diagnostics };
  /** @param {string} code @param {any} page */
  function report(code, page) {
    diagnostics.push({ version: 1, code, severity: 'error', pathname: page.pathname,
      message: code === 'page-version-invalid' ? 'A page has an invalid documentation version.'
        : code === 'page-version-group-invalid' ? 'A page has an invalid logical version identity.'
        : code === 'version-group-ambiguous' ? 'Multiple pages share one locale, version and logical version identity.'
          : 'A declared version alternate disagrees with the known same-locale version inventory.' });
  }
}
/** @param {unknown} value */
function safeUrl(value) {
  try {
    if (typeof value !== 'string') return null;
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

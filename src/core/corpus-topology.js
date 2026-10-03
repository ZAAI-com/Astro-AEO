// @ts-check
import { isPageVersion } from './page-version.js';
import { inspectRootPathname } from './match.js';

/** Shared shape for generation, runtime matching and fallback-route ownership.
 * @param {'auto'|'global'|'locale'|'both'} mode @param {number} [localeCount]
 */
export function chunkTopology(mode, localeCount) {
  if (mode === 'locale' || mode === 'both') return { root: false, locale: true };
  return { root: localeCount === undefined || localeCount <= 1,
    locale: localeCount === undefined || localeCount > 1 };
}

/** Insert only an archive prefix, beneath an existing locale prefix.
 * Paths here are app-relative; the writer alone mounts the Astro base.
 * @param {string} pathname
 * @param {{ locale?: string|null; version?: string; current?: string }} identity
 */
export function corpusPathname(pathname, { locale, version, current }) {
  if (!version || version === current) return pathname;
  if (!isPageVersion(version)) throw new TypeError('Unsafe corpus version.');
  const localePrefix = locale == null ? '' : `/${encodeURIComponent(locale)}`;
  const prefix = localePrefix && pathname.startsWith(`${localePrefix}/`) ? localePrefix : '';
  return `${prefix}/${version}${pathname.slice(prefix.length)}`;
}

/** All version labels in deterministic current/configured/lexical order.
 * @param {readonly { version?: string }[]} pages
 * @param {import('../index.js').ResolvedCorpusVersions} versions
 */
export function corpusVersions(pages, versions) {
  const labels = new Set(pages.map((page) => page.version ?? versions.current));
  labels.add(versions.current);
  const ordered = [versions.current, ...versions.order.filter((version) => labels.has(version))];
  return [...new Set(ordered), ...[...labels].filter((version) => !ordered.includes(version)).sort()];
}

/** Cheap candidate ownership, never authority over an actual project route.
 * @param {string} pathname @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {boolean}
 */
export function isPotentialCorpusArtifactPath(pathname, config) {
  const inspected = inspectRootPathname(pathname);
  if (!inspected) return false;
  pathname = inspected.decoded;
  if (pathname.endsWith('.gz')) {
    return config.corpus.compression.gzip && isPotentialCorpusArtifactPath(pathname.slice(0, -3), config);
  }
  const versioned = config.corpus.versions;
  if (unversionedPath(pathname, config)) return true;
  if (!versioned) return false;
  const segments = pathname.split('/').slice(1);
  for (const position of [0, 1]) {
    const version = segments[position];
    if (!isPageVersion(version) || version === versioned.current) continue;
    const reduced = [...segments]; reduced.splice(position, 1);
    if (position === 0 && !/^llms(?:[.-]|$)/.test(reduced[0] ?? '')) continue;
    if (unversionedPath(`/${reduced.join('/')}`, config)) return true;
  }
  return false;
}

/** @param {string} pathname @param {import('../index.js').ResolvedAstroAeoConfig} config */
function unversionedPath(pathname, config) {
  const mode = config.i18n.indexes;
  const topology = chunkTopology(mode);
  if (pathname === '/llms/manifest.json') return config.corpus.manifest.enabled;
  if (pathname === '/llms/rag.jsonl') return config.corpus.rag.enabled && config.corpus.rag.publish && mode !== 'locale';
  if (/^\/[^/]+\/llms\/rag\.jsonl$/.test(pathname)) {
    return config.corpus.rag.enabled && config.corpus.rag.publish && mode !== 'global';
  }
  const family = /^\/(llms(?:-full|-small)?)\.txt$/.exec(pathname);
  const localized = /^\/[^/]+\/(llms(?:-full|-small)?)\.txt$/.exec(pathname);
  const alias = /^\/(llms(?:-full|-small)?)-[^/]+\.txt$/.exec(pathname);
  const match = family && mode !== 'locale' ? family : localized && mode !== 'global' ? localized
    : alias && mode === 'both' ? alias : null;
  if (match) return enabledFamily(match[1], config);
  return config.corpus.chunks.enabled && (
    (topology.root && /^\/llms\/[^/]+-\d{4,}\.txt$/.test(pathname)) ||
    (topology.locale && /^\/[^/]+\/llms\/[^/]+-\d{4,}\.txt$/.test(pathname)));
}

/** One route-pattern plan consumed by integration injection.
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 */
export function corpusRoutePatterns(config) {
  const mode = config.i18n.indexes;
  const topology = chunkTopology(mode);
  const versioned = Boolean(config.corpus.versions);
  const patterns = new Set();
  const families = [['llms', config.corpus.index.enabled], ['llms-full', config.corpus.full.enabled],
    ['llms-small', config.corpus.small.enabled]];
  for (const [family, enabled] of families) if (enabled && mode !== 'locale') patterns.add(`/${family}.txt`);
  if (config.corpus.manifest.enabled) patterns.add('/llms/manifest.json');
  for (const [family, enabled] of families) if (enabled && mode !== 'global') patterns.add(`/[astroAeoLocale]/${family}.txt`);
  if (config.corpus.chunks.enabled) {
    if (topology.root) patterns.add('/llms/[astroAeoChunk].txt');
    if (topology.locale) patterns.add('/[astroAeoLocale]/llms/[astroAeoChunk].txt');
  }
  for (const [family, enabled] of families) if (enabled && mode === 'both') patterns.add(`/${family}-[astroAeoAlias].txt`);
  if (versioned) {
    for (const [family, enabled] of families) {
      if (!enabled) continue;
      if (mode === 'global') patterns.add(`/[astroAeoLocale]/${family}.txt`);
      else patterns.add(`/[astroAeoLocale]/[astroAeoVersion]/${family}.txt`);
      if (mode === 'both') patterns.add(`/[astroAeoVersion]/${family}-[astroAeoAlias].txt`);
    }
    if (config.corpus.chunks.enabled) {
      if (topology.root) patterns.add('/[astroAeoLocale]/llms/[astroAeoChunk].txt');
      if (topology.locale) patterns.add('/[astroAeoLocale]/[astroAeoVersion]/llms/[astroAeoChunk].txt');
    }
    if (config.corpus.manifest.enabled) patterns.add('/[astroAeoVersion]/llms/manifest.json');
  }
  if (config.corpus.rag.enabled && config.corpus.rag.publish) {
    if (mode !== 'locale') patterns.add('/llms/rag.jsonl');
    if (mode !== 'global' || versioned) patterns.add('/[astroAeoLocale]/llms/rag.jsonl');
    if (versioned && mode !== 'global') patterns.add('/[astroAeoLocale]/[astroAeoVersion]/llms/rag.jsonl');
  }
  return [...patterns];
}
/** @param {string} family @param {import('../index.js').ResolvedAstroAeoConfig} config */
function enabledFamily(family, config) {
  return family === 'llms' ? config.corpus.index.enabled : family === 'llms-full'
    ? config.corpus.full.enabled : config.corpus.small.enabled;
}

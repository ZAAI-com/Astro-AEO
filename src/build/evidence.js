// @ts-check
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalStringify } from './processing-cache.js';
import { inspectRootPathname } from '../core/match.js';

/** Content-derived identities never contain timestamps or cache outcomes.
 * @param {unknown} value
 */
export function evidenceHash(value) {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value)).digest('hex')}`;
}

/** Explicit projection: no source bodies, source locations, URLs, or messages.
 * @param {any[]} pages @param {any[]} ownership @param {boolean} inventoryComplete
 * @returns {import('../index.js').AeoPageSnapshotV1}
 */
export function createPageSnapshot(pages, ownership, inventoryComplete) {
  const records = pages.flatMap((page) => {
    if (!safePath(page.pathname)) return [];
    return [{
      pathname: page.pathname,
      ...(safePath(page.routePattern) ? { routePattern: page.routePattern } : {}),
      locale: label(page.locale ?? page.language), version: label(page.version),
      components: {
        source: typeof page.source?.body === 'string' ? evidenceHash(page.source.body) : null,
        html: evidenceHash(page.representations?.html ?? ''),
        markdown: evidenceHash(page.representations?.markdown ?? page.markdown ?? ''),
        metadata: evidenceHash({ metadata: page.metadata, dates: page.dates, alternates: page.alternates,
          url: page.url, canonicalUrl: page.canonicalUrl, markdownUrl: page.markdownUrl, origin: page.origin }),
        graph: evidenceHash({ entities: page.entities, authors: page.authors }),
        directives: evidenceHash(page.directives),
      },
    }];
  }).sort((a, b) => compare(a, b) || compareText(canonicalStringify(a), canonicalStringify(b)));
  const artifacts = ownership.flatMap((entry) => safePath(entry.pathname) ? [{
    pathname: entry.pathname, status: label(entry.status),
    owner: label(entry.owner?.name),
    etag: typeof entry.representation?.etag === 'string' && /^"[a-f\d]{64}"$/.test(entry.representation.etag)
      ? entry.representation.etag : null,
    byteLength: Number.isSafeInteger(entry.representation?.byteLength) ? entry.representation.byteLength : null,
  }] : []).sort(compare);
  const snapshot = { version: /** @type {const} */ (1), inventoryComplete, pages: records, artifacts };
  return { ...snapshot, buildDigest: evidenceHash(snapshot) };
}

/** Always-on private evidence joins the existing ownership transaction.
 * @param {{ projectRoot: string; pages: any[]; semanticPages: {page: any; graph: any}[];
 * writer: any; inventoryComplete: boolean;
 * trace: {pathname: string; stage: string; outcome: string}[]; diagnostics: any[];
 * cacheReasons?: Record<string, number> }} input
 */
export function stageBuildEvidence(input) {
  /** @type {ReturnType<typeof createPageSnapshot> | undefined} */
  let snapshot;
  const getSnapshot = () => snapshot ??= createPageSnapshot(input.pages,
    input.writer.resolve().manifestEntries, input.inventoryComplete);
  const directory = join(input.projectRoot, '.astro', 'aeo-cache');
  input.writer.stagePrivateWrite(join(directory, 'pages-v1.json'),
    () => `${canonicalStringify(getSnapshot())}\n`, { mode: 0o600, confineTo: input.projectRoot });
  input.writer.stagePrivateWrite(join(directory, 'trace-v1.json'), () => {
    const stages = input.trace.flatMap((entry) => safePath(entry.pathname) &&
      ['hit', 'miss', 'bypass', 'excluded', 'redirect', 'noindex', 'skip-token', 'unreadable', 'isolated', 'dropped', 'kept', 'replaced'].includes(entry.outcome) ? [{
        pathname: entry.pathname, stage: label(entry.stage), outcome: entry.outcome,
      }] : []).sort((a, b) => compare(a, b) || compareText(String(a.stage), String(b.stage)) || compareText(a.outcome, b.outcome));
    const graphs = new Map(input.semanticPages.map((entry) => [entry.page.pathname, entry.graph]));
    const pageTrace = input.pages.filter((page) => safePath(page.pathname)).map((page) => ({
      pathname: page.pathname,
      source: ['marker', 'markdown-route', 'rendered', 'catalog'].includes(page.source?.strategy)
        ? page.source.strategy : null,
      renderer: page.extraction?.strategy?.startsWith('renderer:')
        ? label(page.extraction.strategy.slice('renderer:'.length)) : null,
      graphEntities: graphs.get(page.pathname)?.entries?.length ?? 0,
      graphProvenance: provenanceCounts(graphs.get(page.pathname)),
      htmlTransforms: input.writer.transformOwners(page.htmlPath),
      diagnostics: diagnosticCounts(page.diagnostics ?? []),
    })).sort(compare);
    return `${canonicalStringify({ version: 1, buildDigest: getSnapshot().buildDigest,
      inventoryComplete: input.inventoryComplete, stages, pages: pageTrace,
      artifacts: input.writer.outputActions(), diagnostics: diagnosticCounts(input.diagnostics),
      cacheReasons: Object.fromEntries(Object.entries(input.cacheReasons ?? {})
        .filter(([reason]) => ['disabled', 'read-only', 'key-missing', 'blob-invalid', 'package-version'].includes(reason))),
    })}\n`;
  }, { mode: 0o600, confineTo: input.projectRoot });
}

/** @param {unknown} value */
function safePath(value) { return typeof value === 'string' && value.length <= 2048 && inspectRootPathname(value) !== null; }
/** @param {unknown} value */
function label(value) { return typeof value === 'string' && !/^(?:[a-z]:\/|https?:)/i.test(value) && /^[a-z\d][a-z\d._:/-]{0,127}$/i.test(value) ? value : null; }
/** @param {{pathname: string}} a @param {{pathname: string}} b */
function compare(a, b) { return a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0; }
/** @param {string} a @param {string} b */
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
/** @param {any[]} diagnostics */
function diagnosticCounts(diagnostics) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const diagnostic of diagnostics) {
    const code = label(diagnostic.code);
    if (code && ['info', 'warning', 'error'].includes(diagnostic.severity)) {
      const key = `${diagnostic.severity}:${code}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/** @param {any} graph */
function provenanceCounts(graph) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const entry of graph?.entries ?? []) {
    for (const provenance of entry.provenance ?? []) {
      const source = provenance.source;
      if (['authored-jsonld', 'authored-head', 'configuration', 'inference', 'plugin', 'api'].includes(source)) {
        counts[source] = (counts[source] ?? 0) + 1;
      }
    }
  }
  return counts;
}

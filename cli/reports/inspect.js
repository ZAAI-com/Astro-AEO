// @ts-check
import { join } from 'node:path';
import { optionalJson, readJson, readText, ReportInvocationError } from './io.js';
import { assertContract, assertSnapshot } from './contracts.js';
import { matchesOutputRootId } from '../../src/build/ownership.js';
import { evidenceHash } from '../../src/build/evidence.js';
import { inspectRootPathname, matchPath } from '../../src/core/match.js';

/** @param {string} root @param {{manifest?:string;pages?:string[];dist?:string}} [options]
 * @returns {Promise<import('../../src/index.js').InspectReportV1>} */
export async function inspectReport(root, options = {}) {
  const snapshot = await readJson(join(root,'.astro','aeo-cache','pages-v1.json'),root);
  const digestOk = assertSnapshot(snapshot);
  const trace = await optionalJson(join(root,'.astro','aeo-cache','trace-v1.json'),root);
  if (trace) assertContract(trace,'processing-trace-v1');
  const manifest = options.manifest ? await readManifest(options.manifest) : null;
  /** @type {string[]} */
  const warnings = [];
  if (!digestOk) warnings.push('Snapshot digest mismatch.');
  if (trace && trace.buildDigest !== snapshot.buildDigest) warnings.push('Trace and snapshot digest mismatch.');
  if (trace && trace.inventoryComplete !== snapshot.inventoryComplete) warnings.push('Trace and snapshot inventory completeness mismatch.');
  if (!trace) warnings.push('Private trace is unavailable.');
  await checkPrivateIdentities(root,options.dist ?? join(root,'dist'),snapshot,warnings);
  const companions = manifest?.pages ?? [];
  const traceByPath = new Map((trace?.pages ?? []).map((/** @type {any} */ page) => [page.pathname,page]));
  const stagesByPath = new Map();
  for (const stage of trace?.stages ?? []) {
    const stages = stagesByPath.get(stage.pathname) ?? []; stages.push(stage); stagesByPath.set(stage.pathname,stages);
  }
  const companionsById = new Map();
  for (const companion of companions) {
    const key = JSON.stringify([companion.id,companion.locale ?? null,companion.version ?? null]);
    const group = companionsById.get(key) ?? []; group.push(companion); companionsById.set(key,group);
  }
  return { version:1,type:'inspect',buildDigest:snapshot.buildDigest,inventoryComplete:snapshot.inventoryComplete,warnings,
    pages:snapshot.pages.filter((/** @type {any} */ page) => !options.pages?.length || options.pages.some((pattern) => matchPath(page.pathname,pattern))).map((/** @type {any} */ page) => ({
      snapshot:page,trace:traceByPath.get(page.pathname) ?? null,
      stages:stagesByPath.get(page.pathname) ?? [],
      companions:(companionsById.get(JSON.stringify([page.pathname,page.locale,page.version])) ?? []).flatMap((/** @type {any} */ item) => {
        if (item.id !== page.pathname || (item.locale ?? null) !== page.locale || (item.version ?? null) !== page.version || !item.markdownUrl) return [];
        return [{pathname:new URL(item.markdownUrl).pathname,hash:item.hash,tokenCount:item.tokenCount}];
      }),
    })),artifacts:snapshot.artifacts };
}

/** Public manifests have no buildDigest. Match owned manifest bytes against the snapshot etag.
 * @param {string} manifestFile @param {string} root @param {import('../../src/index.js').InspectReportV1} report */
export async function checkManifestEvidence(manifestFile, root, report) {
  const body = await readText(manifestFile);
  const etag = '"' + evidenceHash(body).slice(7) + '"';
  if (!report.artifacts.some((item) => item.etag === etag)) report.warnings.push('Manifest bytes do not match snapshot ownership etags.');
}

/** Only explicit fields enter reports. Reject unsafe public URLs without echoing them.
 * @param {string} file @returns {Promise<import('../../src/index.js').CorpusManifestV1>} */
export async function readManifest(file) {
  const value = await readJson(file);
  if (!value || value.version !== 1 || !Array.isArray(value.pages) || !Array.isArray(value.artifacts) || typeof value.base !== 'string' ||
    value.pages.length > 100000 || value.artifacts.length > 100000) throw new ReportInvocationError('Invalid corpus manifest.');
  const seen = new Set();
  for (const page of value.pages) {
    const key = JSON.stringify([page?.id,page?.locale,page?.version ?? null]);
    if (!page || typeof page.id !== 'string' || !inspectRootPathname(page.id) || seen.has(key) ||
      (page.language !== undefined && page.language !== null && typeof page.language !== 'string') ||
      (page.section !== undefined && typeof page.section !== 'string') ||
      (page.versionGroup !== undefined && typeof page.versionGroup !== 'string')) throw new ReportInvocationError('Invalid manifest page identity or metadata.');
    seen.add(key);
    for (const field of ['canonicalUrl','markdownUrl']) {
      if (field === 'markdownUrl' && page[field] === null) continue;
      let url; try { url = new URL(page[field]); } catch { throw new ReportInvocationError('Invalid manifest URL.'); }
      if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !inspectRootPathname(url.pathname)) throw new ReportInvocationError('Unsafe manifest URL.');
    }
    if (page.hash !== null && !/^sha256:[a-f\d]{64}$/.test(page.hash) || page.tokenCount !== null && (!Number.isSafeInteger(page.tokenCount) || page.tokenCount < 0) ||
      ![null,'string'].includes(page.locale === null ? null : typeof page.locale) || page.version !== undefined && typeof page.version !== 'string') throw new ReportInvocationError('Invalid manifest page measurements.');
  }
  return value;
}

/** No ledger contents or deployment raw values are copied into the report.
 * @param {string} root @param {string} dist @param {any} snapshot @param {string[]} warnings */
async function checkPrivateIdentities(root,dist,snapshot,warnings) {
  const cache = join(root,'.astro','aeo-cache');
  const deployment = await optionalJson(join(cache,'deployment-v1.json'),root);
  const ownership = await optionalJson(join(cache,'ownership-v1.json'),root);
  if (deployment && (deployment.version !== 1 || !/^sha256:[a-f\d]{64}$/.test(deployment.ownershipDigest))) throw new ReportInvocationError('Invalid deployment evidence.');
  if (ownership) {
    if (ownership.version !== 1 || !/^sha256:[a-f\d]{64}$/.test(ownership.outputRootId) || !Array.isArray(ownership.artifacts) || ownership.artifacts.length > 100000) throw new ReportInvocationError('Invalid ownership evidence.');
    const seen = new Set();
    for (const entry of ownership.artifacts) {
      if (!entry || !inspectRootPathname(entry.pathname) || seen.has(entry.pathname) || !['emitted','runtime','preserved','conflict','group-skipped'].includes(entry.status)) throw new ReportInvocationError('Invalid ownership evidence.');
      seen.add(entry.pathname);
    }
    const digest = evidenceHash(ownership.artifacts.map((/** @type {any} */ entry) => entry.status + ' ' + entry.pathname).sort().join('\n'));
    if (!matchesOutputRootId(ownership.outputRootId,dist)) warnings.push('Ownership and selected build output digest mismatch.');
    if (deployment && deployment.ownershipDigest !== digest) warnings.push('Deployment and ownership digest mismatch.');
    const byPath = new Map(ownership.artifacts.map((/** @type {any} */ item) => [item.pathname,item]));
    for (const artifact of snapshot.artifacts) {
      const entry = /** @type {any} */ (byPath.get(artifact.pathname));
      if (!entry || entry.status !== artifact.status || (entry.representation?.etag ?? null) !== artifact.etag) {
        warnings.push('Snapshot and ownership artifact evidence mismatch.'); break;
      }
    }
  } else if (deployment) warnings.push('Deployment identity cannot be joined without ownership evidence.');
}

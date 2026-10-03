// @ts-check
import { createHash } from 'node:crypto';
import { basicManifestShape } from '../../cli/validate-corpus.js';
import { normalizePublishedText, countApproximateTokens } from '../core/corpus-tokenizer.js';
import { parseSitemapXml } from '../core/sitemap-xml.js';
import { createFinding } from './finding.js';

export const DISCOVERY_LIMIT = 100;
export const DISCOVERY_BYTES = 16 * 1024 * 1024;
/** Anonymous discovery checks share the crawler's redirect/origin/body limits.
 * They never import a site's tokenizer or treat unvisited page targets as missing.
 * @param {string} origin @param {string} base
 * @param {(url:string,accept:string)=>Promise<{status:number;url:string;body:string;contentType:string;bodyHash?:string}|{failure:import('../index.js').Finding}>} request
 * @param {readonly import('./facts.js').PageFacts[]} pages */
export async function auditLiveDiscovery(origin,base,request,pages) {
  const prefix = new URL(base,origin).pathname.replace(/\/$/,'');
  const root = origin + prefix;
  /** @type {import('../index.js').Finding[]} */
  const findings = [];
  /** @type {Map<string,{body:string;contentType:string;bodyHash?:string}|null>} */
  const responses = new Map();
  let bytes = 0, complete = true, corpusObserved = false;
  /** @param {string} ruleId @param {string} message @param {string} url @param {'error'|'warning'|'info'} [severity] */
  function issue(ruleId,message,url,severity = 'warning') { findings.push(createFinding({ruleId,message,url,severity})); }
  /** Advertisements with credentials, queries, fragments or out-of-base origins
   * are rejected before a request. No sensitive spelling reaches evidence.
   * @param {unknown} value */
  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value,root + '/');
      return url.origin === origin && !url.username && !url.password && !url.search && !url.hash &&
        (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) ? url.href : null;
    } catch { return null; }
  }
  /** @param {string} url @param {string} accept @param {boolean} [required] */
  async function fetchResource(url,accept,required = true) {
    if (responses.has(url)) return responses.get(url);
    if (responses.size >= DISCOVERY_LIMIT || bytes >= DISCOVERY_BYTES) {
      complete = false;
      if (!findings.some((item) => item.ruleId === 'live-discovery-limit')) issue('live-discovery-limit','Discovery resource or byte budget reached; remaining artifacts are unknown.',root + '/');
      return null;
    }
    responses.set(url,null);
    const response = await request(url,accept);
    if ('failure' in response) { complete = false; findings.push(response.failure); return null; }
    if (!safeUrl(response.url)) { complete = false; issue('live-discovery-invalid','An artifact redirected outside the selected deployment base.',url); return null; }
    if (response.status >= 400) {
      if (required || response.status !== 404) { complete = false; issue('live-discovery-missing','An advertised or requested discovery artifact returned HTTP ' + response.status + '.',url); }
      return null;
    }
    bytes += Buffer.byteLength(response.body);
    if (bytes > DISCOVERY_BYTES) { complete = false; issue('live-discovery-limit','Discovery byte budget reached; this artifact was not inspected.',url); return null; }
    responses.set(url,response); return response;
  }
  const robotsUrl = root + '/robots.txt';
  const robots = await fetchResource(robotsUrl,'text/plain');
  if (robots && !/^text\/plain\b/i.test(robots.contentType)) issue('live-discovery-invalid','robots.txt is not served as text/plain.',robotsUrl);
  const index = await fetchResource(root + '/llms.txt','text/plain,text/markdown');
  const full = await fetchResource(root + '/llms-full.txt','text/plain,text/markdown');
  /** @type {Array<[string,{body:string;contentType:string;bodyHash?:string}|null|undefined]>} */
  const documents = [['llms.txt',index],['llms-full.txt',full]];
  for (const [name,response] of documents) {
    if (response && (!/^#\s+\S/m.test(response.body) || !/^(?:text\/plain|text\/markdown)\b/i.test(response.contentType))) {
      issue('live-discovery-invalid','A corpus discovery document lacks a heading or a text MIME type.',root + '/' + name);
    }
  }
  corpusObserved = !!(index || full);
  const profile = await fetchResource(root + '/.well-known/domain-profile.json','application/json',false);
  if (profile) {
    if (!/^(?:application\/json|application\/[\w.+-]+\+json)\b/i.test(profile.contentType)) issue('live-discovery-invalid','Domain profile has a non-JSON MIME type.',root + '/.well-known/domain-profile.json');
    try {
      const value = JSON.parse(profile.body);
      if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !safeUrl(value.url)) throw new Error();
    } catch { issue('live-discovery-invalid','Domain profile JSON does not identify this deployment.',root + '/.well-known/domain-profile.json'); }
  }
  const manifestUrl = root + '/llms/manifest.json';
  const manifestResponse = await fetchResource(manifestUrl,'application/json',false);
  if (manifestResponse) {
    if (!/^(?:application\/json|application\/[\w.+-]+\+json)\b/i.test(manifestResponse.contentType)) issue('live-discovery-invalid','Corpus manifest has a non-JSON MIME type.',manifestUrl);
    corpusObserved = true;
    let manifest;
    try { manifest = JSON.parse(manifestResponse.body); } catch { /* Report sanitized shape only. */ }
    if (!basicManifestShape(manifest) || !manifest.artifacts.every((/** @type {any} */ item) => item && typeof item === 'object' && ['identity','gzip'].includes(item.encoding) && typeof item.pathname === 'string') || !manifest.pages.every((/** @type {any} */ item) => item && typeof item === 'object') || manifest.origin !== origin || new URL(manifest.base,origin).pathname.replace(/\/$/,'') !== prefix) {
      issue('live-corpus-invalid','Corpus manifest JSON or deployment identity is invalid.',manifestUrl,'error');
    } else {
      const builtin = manifest.tokenizer.name === 'astro-aeo-approx' && manifest.tokenizer.version === '1' && manifest.tokenizer.approximate === true;
      if (manifest.pages.some((/** @type {any} */ item) => item.hash === null || item.tokenCount === null)) { complete = false; issue('live-corpus-incomplete','Runtime-owned page content is not fully represented by this build manifest.',manifestUrl,'info'); }
      const records = [...manifest.artifacts.filter((/** @type {any} */ record) => record.encoding === 'identity'),...manifest.pages.filter((/** @type {any} */ record) => record.markdownUrl && record.hash !== null && record.tokenCount !== null).map((/** @type {any} */ record) => ({...record,kind:'companion',pathname:record.markdownUrl}))];
      for (const record of records) {
        const url = safeUrl(record.pathname);
        if (!url) { issue('live-corpus-invalid','A corpus record has an unsafe or out-of-base URL.',manifestUrl,'error'); continue; }
        if (!/^sha256:[a-f\d]{64}$/.test(record.hash) || !Number.isSafeInteger(record.tokenCount) || record.tokenCount < 0) {
          issue('live-corpus-invalid','A corpus record has an invalid hash or token count.',manifestUrl,'error'); continue;
        }
        const response = await fetchResource(url,'text/plain,text/markdown,application/x-ndjson');
        if (!response) continue;
        const text = normalizePublishedText(response.body);
        const hash = record.kind === 'companion'
          ? 'sha256:' + createHash('sha256').update(text).digest('hex')
          : response.bodyHash ?? 'sha256:' + createHash('sha256').update(response.body).digest('hex');
        if (hash !== record.hash) issue('live-corpus-hash','Published content does not match its manifest hash.',url,'error');
        if (builtin && countApproximateTokens(text) !== record.tokenCount) issue('live-corpus-tokens','Published content does not match its declared built-in token count.',url,'error');
      }
      if (!builtin) issue('live-corpus-tokenizer-unchecked','Custom tokenizer counts were not recomputed; no consumer module was loaded.',manifestUrl,'info');
      if (manifest.artifacts.some((/** @type {any} */ record) => record.encoding !== 'identity')) issue('live-corpus-encoding-unchecked','Encoded artifacts were not verified against compressed wire bytes.',manifestUrl,'info');
    }
  }
  const sitemaps = new Set();
  for (const match of (robots?.body ?? '').matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gmi)) {
    const url = safeUrl(match[1]);
    if (url) sitemaps.add(url); else issue('live-discovery-invalid','A sitemap advertisement is unsafe or outside this base.',robotsUrl);
  }
  for (const match of (robots?.body ?? '').matchAll(/^\s*(?:#\s*)?(?:llms\.txt|AEO-Corpus|LLMs-Txt):\s*(\S+)\s*$/gmi)) {
    const url = safeUrl(match[1]);
    if (url) await fetchResource(url,'text/plain,text/markdown'); else issue('live-discovery-invalid','A corpus advertisement is unsafe or outside this base.',robotsUrl);
  }
  const visited = new Set();
  /** @type {Map<string,string>} */
  const parents = new Map();
  const canonical = new Map(pages.map((page) => [page.url.replace(/\/$/,''),page.canonical]));
  while (sitemaps.size && responses.size < DISCOVERY_LIMIT && bytes < DISCOVERY_BYTES) {
    const url = [...sitemaps].sort()[0]; sitemaps.delete(url);
    if (visited.has(url)) continue; visited.add(url);
    const response = await fetchResource(url,'application/xml,text/xml');
    if (!response) continue;
    if (!/^(?:application\/xml|text\/xml)\b/i.test(response.contentType)) issue('live-discovery-invalid','Sitemap has a non-XML MIME type.',url);
    const parsed = parseSitemapXml(response.body);
    if (parsed.findings.length) issue('live-sitemap-invalid','Sitemap XML does not satisfy the sitemap contract.',url,'error');
    for (const value of parsed.locations) {
      const child = safeUrl(value);
      let ancestor = url, cyclic = child === url;
      while (parents.has(ancestor)) { ancestor = /** @type {string} */ (parents.get(ancestor)); if (ancestor === child) {cyclic = true;break;} }
      if (!child || cyclic) issue('live-sitemap-invalid','A sitemap index target is unsafe, outside this base, or cyclic.',url,'error');
      else if (!visited.has(child) && !sitemaps.has(child)) {parents.set(child,url);sitemaps.add(child);}
    }
    const seen = new Set();
    for (const entry of parsed.urls) {
      const target = safeUrl(entry.loc);
      if (!target || seen.has(target)) { issue('live-sitemap-invalid','A sitemap page URL is unsafe, duplicated, or outside this base.',url,'error'); continue; }
      seen.add(target);
      const authored = canonical.get(target.replace(/\/$/,''));
      if (authored && authored !== target) issue('live-sitemap-invalid','A visited page canonical differs from its sitemap URL.',target,'error');
    }
  }
  if (sitemaps.size) { complete = false; issue('live-discovery-limit','Sitemap discovery is incomplete at the resource budget.',root + '/'); }
  return {findings,complete,corpusObserved,fetched:responses.size};
}

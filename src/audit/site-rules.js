// @ts-check
import { markdownRegion } from './regions.js';
import { validateGraph } from '../schema.js';
import { createFinding, fromGraphFinding } from './finding.js';
import { auditEditorial } from './editorial.js';
import { checkGoogleSchema } from '../core/schema-google.js';
import { documentUrlFor } from './facts.js';

/**
 * Site-wide rules over `PageFacts`. Every cross-page check goes through a map
 * keyed by a normalized value, so the work stays linear in pages plus links.
 *
 * @typedef {import('./facts.js').PageFacts} PageFacts
 * @typedef {import('../index.js').Finding} Finding
 *
 * @typedef {object} LinkResolver
 * @property {(from: PageFacts, href: string) => { key: string; fragment: string } | null} resolve
 *   Identity of an internal target, or null for an external or non-navigable href.
 * @property {(key: string) => PageFacts | null | undefined} lookup
 *   The target page, null for an existing non-page resource, undefined when nothing is there.
 */

export const THIN_MARKDOWN_WORDS = 40;
export const RAW_HTML_MIN_BLOCKS = 3;
export const RAW_HTML_MIN_TAGS = 30;
export const RAW_HTML_MARKUP_RATIO = 0.25;

// Layout elements, and any tag still carrying presentation (classes, inline styles, data attributes).
const RESIDUE = /<\/?(?:div|span|section|article|nav|header|footer|script|style|iframe|figure|figcaption|dl|dt|dd)\b|<[a-z][\w-]*\s[^>]*\b(?:class|style|data-[\w-]+)=/i;
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*?)?\s*\/?>/gi;
// Resolve references against definitions from all observed pages.
const UNRESOLVED_REFERENCE = 'schema.unresolved-reference';

/**
 * @param {readonly PageFacts[]} pages
 * @param {{ links?: LinkResolver; siteUrl?: string; heuristics?: boolean; schemaTarget?: 'schema' | 'google'; now?: Date; inventoryComplete?: boolean }} [options]
 * @returns {Finding[]}
 */
export function auditPages(pages, options = {}) {
  /** @type {Finding[]} */
  const findings = [];
  const now = options.now ?? new Date();
  const graphs = new Map();
  for (const page of pages) graphs.set(page,readPageGraph(page,options.siteUrl,findings));
  const knownIds = new Set();
  for (const graph of graphs.values()) for (const entry of graph.entries) collectDefinitions(entry.entity,knownIds,true);
  const documents = new Set(pages.map((page) => documentIdentity(page.documentUrl ?? documentUrlFor(page.url,page.canonical,options.siteUrl))).filter(Boolean));
  for (const page of pages) {
    auditMetadata(page, findings);
    auditMarkdown(page, findings);
    auditSiteReferences(page,graphs.get(page),knownIds,documents,options,findings);
    if (options.heuristics) findings.push(...auditEditorial(page, now));
    if (options.schemaTarget === 'google') {
      const entities = page.jsonLd.flatMap((body) => {
        try { return [JSON.parse(body)]; } catch { return []; }
      });
      for (const finding of checkGoogleSchema(entities, { documentUrl: page.documentUrl ?? documentUrlFor(page.url, page.canonical, options.siteUrl) })) {
        findings.push(createFinding({ ...finding, url: page.url, file: page.file }));
      }
    }
  }
  auditDuplicates(pages, findings);
  auditContentDuplicates(pages,findings);
  auditVersionAlternates(pages, findings, options.siteUrl);
  if (options.links) {
    auditLinks(pages, options.links, findings);
    auditAlternates(pages, options.links, findings);
  }
  return findings;
}

/** @param {PageFacts} page @param {Finding[]} findings */
function auditMetadata(page, findings) {
  if (page.noindex) return;
  if (!page.description) {
    findings.push(at(page, 'description-missing', 'warning', `no meta description: ${page.url}`));
  }
  if (!page.language && page.renderedHtml) {
    findings.push(at(page, 'html-lang-missing', 'warning', `the html element has no lang attribute: ${page.url}`));
  }
}

/** @param {PageFacts} page @param {Finding[]} findings */
function auditMarkdown(page, findings) {
  if (page.markdown === undefined) return;
  const prose = stripFences(page.markdown);
  // Link and image destinations are not prose, and a word needs a letter or a digit.
  const words = prose.replace(/\]\([^)\n]*\)/g, ']').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  if (words === 0) {
    findings.push(at(page, 'markdown-empty', 'error', `the Markdown companion is empty: ${page.url}`));
    return;
  }
  if (words < THIN_MARKDOWN_WORDS && !page.noindex) {
    findings.push(at(page, 'markdown-thin', 'warning',
      `the Markdown companion has ${words} words, fewer than ${THIN_MARKDOWN_WORDS}: ${page.url}`));
  }
  if (!/^#\s+\S/m.test(prose)) {
    findings.push(at(page, 'markdown-no-h1', 'warning', `the Markdown companion has no top-level heading: ${page.url}`));
  }
  const residue = RESIDUE.exec(prose);
  if (residue) {
    findings.push({
      ...at(page, 'markdown-html-residue', 'warning', `the Markdown companion still contains layout HTML: ${page.url}`),
      evidence: residue[0],
    });
  }
  const htmlBlocks = prose.split(/\n\s*\n/).map((block) =>
    [...block.matchAll(HTML_TAG)].filter((tag) => !tag[0].includes('\\>')));
  const blocks = htmlBlocks.filter((tags) => tags.length > 0).length;
  const tags = htmlBlocks.flat();
  const markupCharacters = tags.reduce((length, tag) => length + tag[0].length, 0);
  if (blocks >= RAW_HTML_MIN_BLOCKS &&
      (tags.length >= RAW_HTML_MIN_TAGS || markupCharacters / prose.length > RAW_HTML_MARKUP_RATIO)) {
    findings.push(at(page, 'markdown-raw-html', 'warning',
      `the Markdown companion contains ${tags.length} HTML tags across ${blocks} blocks: ${page.url}`));
  }
}

/**
 * As the build inspects authored JSON-LD, each entity is validated alone first,
 * without its `@context` and without strict references, so one bad third-party
 * node cannot hide the rest. References are then resolved once across every
 * valid entity of the page, so a sibling in the same `@graph` or another script
 * resolves, while an `@id` defined on another page stays a legitimate reference.
 *
 * @param {PageFacts} page @param {string | undefined} siteUrl @param {Finding[]} findings
 */
function readPageGraph(page, siteUrl, findings) {
  const canonical = page.documentUrl ?? documentUrlFor(page.url,page.canonical,siteUrl);
  const options = { ...(canonical ? {documentCanonical:canonical} : {}), strictReferences:false };
  const entries = [], scripts = [];
  for (const [scriptIndex,body] of page.jsonLd.entries()) {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch {
      findings.push(withScriptRegion(page,at(page,'authored-jsonld-malformed','error','A JSON-LD script is not valid JSON.'),scriptIndex));
      continue;
    }
    for (const entity of graphEntities(parsed)) {
      const { '@context': _context, ...withoutContext } = entity;
      const result = validateGraph(/** @type {any} */ ([withoutContext]),options);
      for (const graphFinding of result.findings.filter((item) => item.code !== UNRESOLVED_REFERENCE)) {
        findings.push(withScriptRegion(page,{...fromGraphFinding({...graphFinding,pathname:page.url}),...(page.file ? {file:page.file} : {})},scriptIndex));
      }
      if (result.valid) { entries.push(...result.graph.entries); scripts.push(...result.graph.entries.map(() => scriptIndex)); }
    }
  }
  return {entries,scripts,canonical};
}

/** Full-site IDs do not turn an unobserved target into evidence of a defect.
 * @param {PageFacts} page @param {ReturnType<typeof readPageGraph>} graph
 * @param {Set<string>} knownIds @param {Set<any>} documents
 * @param {{siteUrl?:string;inventoryComplete?:boolean}} options @param {Finding[]} findings */
function auditSiteReferences(page,graph,knownIds,documents,options,findings) {
  if (!graph.entries.length) return;
  const siteUrl = options.siteUrl ?? (graph.canonical ? new URL(graph.canonical).origin : undefined);
  const site = siteUrl ? new URL(siteUrl) : undefined;
  for (const [index,entry] of graph.entries.entries()) {
    for (const reference of referencesIn(entry.entity,`/entries/${index}/entity`,true)) {
      if (knownIds.has(reference.id)) continue;
      const url = new URL(reference.id);
      const target = documentIdentity(reference.id);
      const sameDocument = target === documentIdentity(graph.canonical);
      const sameSite = site && url.origin === site.origin && (url.pathname === site.pathname || url.pathname.startsWith(site.pathname.endsWith('/') ? site.pathname : site.pathname + '/'));
      if (!sameDocument && (!sameSite || !documents.has(target) && !options.inventoryComplete)) continue;
      findings.push(withScriptRegion(page,{...fromGraphFinding({version:1,code:UNRESOLVED_REFERENCE,severity:'warning',
        message:sameDocument ? 'Same-document schema reference does not resolve' : 'Known same-site schema reference does not resolve',
        entityId:reference.id,pointer:reference.pointer,pathname:page.url}),...(page.file ? {file:page.file} : {})},graph.scripts[index] ?? 0));
    }
  }
}
/** @param {any} value @param {Set<string>} ids @param {boolean} [topLevel] */
function collectDefinitions(value,ids,topLevel = false) {
  if (Array.isArray(value)) { for (const child of value) collectDefinitions(child,ids); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value['@id'] === 'string' && (topLevel || Object.keys(value).some((key) => key !== '@id'))) ids.add(value['@id']);
  for (const [key,child] of Object.entries(value)) if (key !== '@id') collectDefinitions(child,ids);
}
/** Graph entries already passed validation and ID normalization. Use a shared
 * definition set, rather than validating the entire site-ID list for every page.
 * @param {any} value @param {string} pointer @param {boolean} [topLevel]
 * @returns {Array<{id:string;pointer:string}>} */
function referencesIn(value,pointer,topLevel = false) {
  if (Array.isArray(value)) return value.flatMap((child,index) => referencesIn(child,pointer + '/' + index));
  if (!value || typeof value !== 'object') return [];
  if (!topLevel && typeof value['@id'] === 'string' && Object.keys(value).length === 1)
    return [{id:value['@id'],pointer:pointer + '/@id'}];
  return Object.entries(value).filter(([key]) => key !== '@id').flatMap(([key,child]) =>
    referencesIn(child,pointer + '/' + key.replaceAll('~','~0').replaceAll('/','~1')));
}
/** @param {string|undefined} value */
function documentIdentity(value) {
  if (!value) return undefined;
  try { const url = new URL(value); url.hash = ''; return url.href; } catch { return undefined; }
}
/** @param {PageFacts} page @param {Finding} finding @param {number} index */
function withScriptRegion(page,finding,index) {
  const scripts = page.regions?.filter((item) => item.tag === 'script' && item.attrs.type?.toLowerCase() === 'application/ld+json');
  const script = scripts?.length === page.jsonLd.length ? scripts[index] : undefined;
  return script ? {...finding,location:script.location,locationSource:/** @type {const} */ ('rendered-html')} : finding;
}

/** @param {unknown} value @returns {Record<string, unknown>[]} */
function graphEntities(value) {
  if (Array.isArray(value)) return value.flatMap(graphEntities);
  if (!value || typeof value !== 'object') return [];
  const record = /** @type {Record<string, unknown>} */ (value);
  return Array.isArray(record['@graph']) ? record['@graph'].flatMap(graphEntities) : [record];
}

/** @param {readonly PageFacts[]} pages @param {Finding[]} findings */
function auditDuplicates(pages, findings) {
  /** @type {[keyof PageFacts & ('title'|'description'|'canonical'), string, string][]} */
  const checks = [
    ['title', 'title-duplicate', 'title'],
    ['description', 'description-duplicate', 'meta description'],
    ['canonical', 'canonical-duplicate', 'canonical URL'],
  ];
  for (const [field, ruleId, label] of checks) {
    /** @type {Map<string, PageFacts[]>} */
    const groups = new Map();
    for (const page of pages) {
      const value = page[field];
      if (!value || page.noindex) continue;
      const group = groups.get(value);
      if (group) group.push(page);
      else groups.set(value, [page]);
    }
    for (const [value, group] of groups) {
      if (group.length < 2) continue;
      const urls = group.map((page) => page.url).sort();
      const counts = new Map();
      for (const url of urls) counts.set(url,(counts.get(url) ?? 0)+1);
      for (const page of group) {
        const count = urls.length - (counts.get(page.url) ?? 0);
        const first = urls[0] === page.url ? urls[(counts.get(page.url) ?? 0)] : urls[0];
        findings.push({
          ...at(page, ruleId, 'warning',
            `${label} is shared with ${count} other page(s), first ${first}: ${page.url}`),
          evidence: value,
        });
      }
    }
  }
}

/** @param {readonly PageFacts[]} pages @param {LinkResolver} links @param {Finding[]} findings */
function auditLinks(pages, links, findings) {
  for (const page of pages) {
    const seen = new Set();
    for (const href of page.links) {
      if (seen.has(href)) continue;
      seen.add(href);
      const target = links.resolve(page, href);
      if (!target) continue;
      const found = links.lookup(target.key);
      if (found === undefined) {
        findings.push({ ...at(page, 'link-internal-broken', 'error', `internal link has no target: ${page.url}`,href), evidence: href });
      } else if (found && target.fragment && !found.anchors.has(target.fragment)) {
        findings.push({ ...at(page, 'link-anchor-missing', 'warning', `link fragment has no matching id: ${page.url}`,href), evidence: href });
      }
    }
  }
}

/** @param {readonly PageFacts[]} pages @param {LinkResolver} links @param {Finding[]} findings */
function auditAlternates(pages, links, findings) {
  for (const page of pages) {
    for (const alternate of page.alternates) {
      const target = links.resolve(page, alternate.href);
      if (!target) continue;
      const found = links.lookup(target.key);
      if (found === undefined) {
        findings.push({
          ...at(page, 'hreflang-target-missing', 'error', `hreflang ${alternate.language} points at a missing page: ${page.url}`,alternate.href),
          evidence: alternate.href,
        });
        continue;
      }
      if (!found || found === page) continue;
      const returns = found.alternates.some((back) => {
        const resolved = links.resolve(found, back.href);
        return resolved !== null && links.lookup(resolved.key) === page;
      });
      if (!returns) {
        findings.push({
          ...at(page, 'hreflang-return-missing', 'warning',
            `hreflang ${alternate.language} target does not link back: ${page.url}`,alternate.href),
          evidence: alternate.href,
        });
      }
    }
  }
}

/** @param {PageFacts} page @param {string} ruleId @param {Finding['severity']} severity @param {string} message @param {string} [href] */
function at(page,ruleId,severity,message,href) {
  const markdown = ruleId.startsWith('markdown-');
  const field = ruleId.startsWith('title-') ? 'title' : ruleId.startsWith('description-') ? 'description' :
    ruleId.startsWith('canonical-') ? 'canonical' : ruleId === 'html-lang-missing' ? 'html' : null;
  const element = page.regions?.find((item) =>
    field === 'title' ? item.tag === 'title' : field === 'description' ? item.tag === 'meta' && item.attrs.name?.toLowerCase() === 'description' :
    field === 'canonical' ? item.tag === 'link' && item.attrs.rel?.toLowerCase() === 'canonical' :
    field === 'html' ? item.tag === 'html' :
    href ? item.tag === (ruleId.startsWith('hreflang-') ? 'link' : 'a') && item.attrs.href?.trim() === href && (!ruleId.startsWith('hreflang-') || item.attrs.rel?.toLowerCase().split(/\s+/).includes('alternate') && !!item.attrs.hreflang) : false);
  const location = markdown && ruleId === 'markdown-html-residue' && page.markdownFile && page.markdown
    ? markdownRegion(page.markdown,RESIDUE) : !markdown ? element?.location : undefined;
  return createFinding({ruleId,severity,message,url:page.url,
    file:markdown ? page.markdownFile : page.file,
    ...(location ? {location,locationSource:markdown ? 'markdown' : 'rendered-html'} : {})});
}

/** Exact normalized content, not a similarity heuristic. Avoid shared chrome,
 * short/empty content, noindex pages and intentional cross-locale/version copies.
 * @param {readonly PageFacts[]} pages @param {Finding[]} findings */
function auditContentDuplicates(pages,findings) {
  /** @type {Map<string, PageFacts[]>} */
  const groups = new Map();
  for (const page of pages) {
    if (page.noindex || !page.contentHash || (page.contentWords ?? 0) < THIN_MARKDOWN_WORDS) continue;
    const key = JSON.stringify([page.contentHash,page.locale ?? page.language ?? null,page.version ?? null]);
    const group = groups.get(key) ?? []; group.push(page); groups.set(key,group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a,b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
    const byCanonical = new Map();
    for (const page of ordered) {
      const key = page.canonical ?? page.url;
      const peers = byCanonical.get(key) ?? []; peers.push(page); byCanonical.set(key,peers);
    }
    const first = ordered[0];
    const other = ordered.find((page) => (page.canonical ?? page.url) !== (first.canonical ?? first.url));
    for (const page of ordered) {
      const key = page.canonical ?? page.url;
      const count = group.length - byCanonical.get(key).length;
      const peer = key !== (first.canonical ?? first.url) ? first : other;
      if (count && peer) findings.push(at(page,'content-duplicate','warning',
        'Visible main content matches ' + count + ' other page(s), first ' + peer.url + '.'));
    }
  }
}

/** @param {string} markdown */
function stripFences(markdown) {
  return markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** @param {string | undefined} value */
function absolute(value) {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

/** Audit known records only; an unobserved external target is not evidence of a defect.
 * @param {readonly PageFacts[]} pages @param {Finding[]} findings @param {string} [siteUrl]
 */
function auditVersionAlternates(pages, findings, siteUrl) {
  /** @type {Map<string, PageFacts>} */
  const urls = new Map();
  const identity = (/** @type {PageFacts} */ page) => documentUrlFor(page.url, page.canonical, siteUrl);
  for (const page of pages) { const url = identity(page); if (url) urls.set(url, page); }
  for (const page of pages) for (const alternate of page.versionAlternates ?? []) {
    const target = urls.get(alternate.url);
    if (!target) continue;
    const locale = page.locale ?? page.language;
    const targetLocale = target.locale ?? target.language;
    if (locale !== targetLocale || target.version !== alternate.version) {
      findings.push(at(page, 'version-alternate-identity-conflict', 'error', 'A known version alternate has a different locale or version identity.'));
    }
    if (!(target.versionAlternates ?? []).some((candidate) => candidate.url === identity(page) && candidate.version === page.version)) {
      findings.push(at(page, 'version-alternate-not-reciprocal', 'error', 'A known version alternate does not link back to the source version.'));
    }
  }
}

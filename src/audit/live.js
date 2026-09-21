// @ts-check
import { compareCodeUnits } from '../core/corpus-manifest.js';
import { extractPageFacts } from './facts.js';
import { createFinding } from './finding.js';
import { auditPages } from './site-rules.js';

/**
 * @typedef {import('./facts.js').PageFacts} PageFacts
 * @typedef {import('../index.js').Finding} Finding
 * @typedef {import('../index.js').AuditCrawlScope} AuditCrawlScope
 */

export const LIVE_DEFAULTS = Object.freeze({ maxPages: 500, timeout: 10_000, concurrency: 8 });
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** The start URL could not be audited at all. The CLI maps this to exit status 2. */
export class AuditTargetError extends Error {}

/**
 * Crawl a deployed site anonymously. Requests carry no cookie, no authorization
 * and no caller header; only allowlisted origins are ever contacted, and every
 * redirect hop is checked against that list before it is followed.
 *
 * Pages are fetched one breadth-first level at a time and each level is queued in
 * sorted order, so which pages fit under the cap never depends on response timing.
 *
 * @param {string} startUrl
 * @param {{
 *   maxPages?: number | 'unlimited';
 *   allowOrigins?: string[];
 *   timeout?: number;
 *   concurrency?: number;
 *   toolVersion?: string;
 *   fetch?: typeof globalThis.fetch;
 * }} [options]
 * @returns {Promise<{ findings: Finding[]; pagesChecked: number; languageCount: number; scope: AuditCrawlScope }>}
 */
export async function auditLive(startUrl, options = {}) {
  const start = parseTarget(startUrl);
  const maxPages = options.maxPages ?? LIVE_DEFAULTS.maxPages;
  const limit = maxPages === 'unlimited' ? Number.POSITIVE_INFINITY : maxPages;
  const origins = new Set([start.origin, ...(options.allowOrigins ?? []).map((origin) => parseTarget(origin).origin)]);
  const request = createRequester({
    fetch: options.fetch ?? globalThis.fetch,
    timeout: options.timeout ?? LIVE_DEFAULTS.timeout,
    origins,
    userAgent: `astro-aeo-audit/${options.toolVersion ?? '0'}`,
  });
  const concurrency = options.concurrency ?? LIVE_DEFAULTS.concurrency;

  /** @type {Finding[]} */
  const findings = [];
  /** Identity to page, `null` for a non-HTML resource, `undefined` for a target that is not there. @type {Map<string, PageFacts | null | undefined>} */
  const visited = new Map();
  /** @type {PageFacts[]} */
  const pages = [];
  const external = new Set();
  let truncated = false;
  let level = [identity(start)];
  const queued = new Set(level);

  while (level.length > 0) {
    const room = limit - visited.size;
    if (room <= 0) {
      truncated = true;
      break;
    }
    if (level.length > room) truncated = true;
    const batch = level.slice(0, room);
    const results = await mapConcurrent(batch, concurrency, async (url) => ({ url, page: await fetchPage(url) }));
    /** @type {Set<string>} */
    const next = new Set();
    for (const { url, page } of results) {
      if (page.failure) findings.push(page.failure);
      if (url === batch[0] && visited.size === 0 && !page.facts) {
        throw new AuditTargetError(`could not audit ${url}: ${page.failure?.message ?? 'no HTML response'}`);
      }
      if (page.finalUrl && page.finalUrl !== url && visited.has(page.finalUrl)) {
        // A redirect onto a page already audited: one page, two spellings.
        visited.set(url, visited.get(page.finalUrl));
        continue;
      }
      // Only a hard failure proves a target is missing; a skipped or oversized one is unknown.
      const state = page.facts ?? (page.failure?.severity === 'error' ? undefined : null);
      visited.set(url, state);
      if (page.finalUrl && page.finalUrl !== url) visited.set(page.finalUrl, state);
      if (!page.facts) continue;
      pages.push(page.facts);
      for (const href of [...page.facts.links, ...page.facts.alternates.map((alternate) => alternate.href)]) {
        const target = resolveHref(page.facts.url, href);
        if (!target) continue;
        if (!origins.has(target.origin)) {
          external.add(target.origin);
          continue;
        }
        const key = identity(target);
        if (!queued.has(key) && looksLikePage(target)) {
          queued.add(key);
          next.add(key);
        }
      }
    }
    level = [...next].sort(compareCodeUnits);
  }

  if (truncated) {
    findings.push(createFinding({
      ruleId: 'live-page-cap-reached',
      severity: 'warning',
      message: `the crawl stopped at the ${maxPages}-page cap; raise --max-pages to audit the rest`,
    }));
  }
  for (const origin of [...external].sort(compareCodeUnits)) {
    findings.push(createFinding({
      ruleId: 'live-external-skipped',
      severity: 'info',
      message: `links to ${origin} were not followed; add --allow-origin to include it`,
      url: origin,
    }));
  }

  findings.push(...auditPages(pages, {
    siteUrl: start.origin,
    links: {
      resolve(from, href) {
        const target = resolveHref(from.url, href);
        if (!target || !origins.has(target.origin)) return null;
        let fragment = target.hash.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          // Keep the raw fragment: it simply will not match an id.
        }
        return { key: identity(target), fragment };
      },
      // A target the crawl never reached is unknown, not missing.
      lookup: (key) => (visited.has(key) ? visited.get(key) : null),
    },
  }));

  const languages = new Set(pages.map((page) => page.language?.toLowerCase().split('-')[0]).filter(Boolean));
  return {
    findings,
    pagesChecked: pages.length,
    languageCount: languages.size,
    scope: {
      origins: [...origins].sort(compareCodeUnits),
      maxPages,
      pagesFetched: pages.length,
      truncated,
      skippedExternal: external.size,
    },
  };

  /**
   * @param {string} url
   * @returns {Promise<{ facts?: PageFacts; finalUrl?: string; failure?: Finding }>}
   */
  async function fetchPage(url) {
    const response = await request(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
    if ('failure' in response) return { failure: response.failure };
    if (response.status >= 400) {
      return {
        failure: createFinding({ ruleId: 'live-fetch-failed', severity: 'error', message: `HTTP ${response.status}: ${url}`, url }),
      };
    }
    if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(response.contentType)) return { finalUrl: response.url };
    const facts = extractPageFacts(response.body, { url: response.url });
    const markdownHref = facts.markdownAlternates[0];
    const markdownUrl = markdownHref ? resolveHref(response.url, markdownHref) : null;
    if (markdownUrl && origins.has(markdownUrl.origin)) {
      const markdown = await request(identity(markdownUrl), 'text/markdown');
      if (!('failure' in markdown) && markdown.status < 400) {
        facts.markdown = markdown.body;
        if (!/^text\/markdown\b/i.test(markdown.contentType)) {
          findings.push(createFinding({
            ruleId: 'live-markdown-mime',
            severity: 'warning',
            message: `the Markdown companion is served as "${markdown.contentType || 'no content type'}", not text/markdown`,
            url: identity(markdownUrl),
          }));
        }
      }
    }
    return { facts, finalUrl: response.url };
  }
}

/**
 * @param {{ fetch: typeof globalThis.fetch; timeout: number; origins: Set<string>; userAgent: string }} context
 */
function createRequester(context) {
  /**
   * @param {string} url
   * @param {string} accept
   * @returns {Promise<{ status: number; url: string; contentType: string; body: string } | { failure: Finding }>}
   */
  return async function request(url, accept) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let response;
      try {
        response = await context.fetch(current, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: { accept, 'user-agent': context.userAgent },
          signal: AbortSignal.timeout(context.timeout),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'could not be fetched';
        return { failure: createFinding({ ruleId: 'live-target-unreachable', severity: 'error', message: `${current} ${reason}`, url }) };
      }
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        const target = resolveHref(current, location);
        if (!target || !context.origins.has(target.origin)) {
          return {
            failure: createFinding({
              ruleId: 'live-external-skipped',
              severity: 'info',
              message: `${url} redirects outside the allowed origins and was not followed`,
              url,
            }),
          };
        }
        current = identity(target);
        continue;
      }
      const body = await readCapped(response);
      if (body === null) {
        return {
          failure: createFinding({ ruleId: 'live-body-too-large', severity: 'warning', message: `the response exceeds ${MAX_BODY_BYTES} bytes and was not audited: ${current}`, url }),
        };
      }
      return { status: response.status, url: current, contentType: response.headers.get('content-type') ?? '', body };
    }
    return {
      failure: createFinding({ ruleId: 'live-redirect-limit', severity: 'warning', message: `more than ${MAX_REDIRECTS} redirects: ${url}`, url }),
    };
  };
}

/** @param {Response} response @returns {Promise<string | null>} */
async function readCapped(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>} Results in input order.
 */
async function mapConcurrent(items, concurrency, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

/** @param {string} value */
function parseTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AuditTargetError(`not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AuditTargetError(`not an http(s) URL: ${value}`);
  if (url.username || url.password) throw new AuditTargetError('URLs with credentials are not audited');
  return url;
}

/** @param {string} from @param {string} href */
function resolveHref(from, href) {
  try {
    const url = new URL(href, from);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A page identity ignores the query and the fragment. @param {URL} url */
function identity(url) {
  return `${url.origin}${url.pathname}`;
}

/** Skip obvious assets so the page budget is spent on pages. @param {URL} url */
function looksLikePage(url) {
  const extension = /\.([a-z\d]+)$/i.exec(url.pathname)?.[1]?.toLowerCase();
  return !extension || extension === 'html' || extension === 'htm';
}

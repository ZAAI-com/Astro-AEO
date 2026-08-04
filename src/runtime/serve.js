// @ts-check
import { buildPage, basePrefix, pagePathForMdPath } from '../core/page-model.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { renderLlmsTxt, renderLlmsFullTxt } from '../core/render/llms-txt.js';
import { buildRobotsTxt } from '../core/render/robots-txt.js';
import { buildDomainProfile } from '../core/render/domain-profile.js';
import { resolveSiteMeta } from '../core/site-meta.js';

/**
 * What the runtime serves, independent of how the request reached it.
 *
 * Every representation here comes from the same functions the build uses. The
 * only difference is where the HTML came from.
 */

/**
 * @typedef {object} Runtime
 * @property {'dev'|'build'|'preview'} command
 * @property {import('../index.js').ResolvedAstroAeoConfig} config
 * @property {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} site
 * @property {string[]} staticPaths
 */

/** @typedef {(pathname: string) => Promise<string | null>} HtmlFetcher */

/**
 * Strip Astro's `base` from an incoming pathname, so everything downstream deals
 * in site-root paths.
 * @param {string} pathname
 * @param {string} base
 * @returns {string}
 */
export function stripBase(pathname, base) {
  const prefix = basePrefix(base);
  if (!prefix || !pathname.startsWith(prefix)) return pathname;
  return pathname.slice(prefix.length) || '/';
}

/**
 * Which owned artifact a path refers to, if any. Only paths the configuration
 * actually enables are claimed, so a disabled feature falls through to the
 * project's own routing.
 * @param {string} pathname  Already base-stripped.
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @returns {'robots'|'domain-profile'|'llms'|'llms-full'|null}
 */
export function artifactFor(pathname, config) {
  if (pathname === '/robots.txt' && config.discovery.robots.enabled) return 'robots';
  if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) {
    return 'domain-profile';
  }
  if (pathname === '/llms.txt' && config.corpus.index.enabled) return 'llms';
  if (pathname === '/llms-full.txt' && config.corpus.full.enabled) return 'llms-full';
  return null;
}

/**
 * Render the two artifacts that need no page content.
 * @param {'robots'|'domain-profile'} kind
 * @param {Runtime} runtime
 * @param {{ sitemapAvailable?: boolean }} [opts]
 * @returns {{ body: string; contentType: string }}
 */
export function renderStandaloneArtifact(kind, runtime, opts = {}) {
  const { config, site } = runtime;
  if (kind === 'robots') {
    // Automatic mode verifies the sitemap exists in the build output, which the
    // runtime cannot see, so at request time only an explicit `always` advertises.
    const policy = config.discovery.robots.sitemapPolicy;
    const available = opts.sitemapAvailable ?? policy === 'always';
    return {
      body: buildRobotsTxt(config, site.siteUrl, site.base, available),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  return {
    body: `${JSON.stringify(buildDomainProfile(config, site.siteUrl), null, 2)}\n`,
    contentType: 'application/json; charset=utf-8',
  };
}

/**
 * Normalize one page from its rendered HTML.
 * @param {string} pathname
 * @param {string} html
 * @param {Runtime} runtime
 * @returns {import('../core/page-model.js').AeoPage | null}
 */
export function pageFromHtml(pathname, html, runtime) {
  const result = buildPage({
    pathname,
    html,
    config: runtime.config,
    site: runtime.site,
  });
  return 'skip' in result ? null : result.page;
}

/**
 * The `.md` body for a page, or null when the page opts out or does not exist.
 * @param {string} mdPathname   Already base-stripped, ending in `.md`.
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @returns {Promise<string | null>}
 */
export async function serveMarkdown(mdPathname, runtime, fetchHtml) {
  const pagePath = pagePathForMdPath(mdPathname);
  if (pagePath === null) return null;

  const html = await fetchHtml(pagePath);
  if (html === null) return null;

  const page = pageFromHtml(pagePath, html, runtime);
  if (!page || page.aeoTokens.has('no-dotmd')) return null;
  return renderMarkdownDocument(page, runtime.config);
}

/**
 * Build a corpus index from the concrete routes the build knew about.
 *
 * Best-effort by construction: it can only cover routes that were known at build
 * time, so a purely dynamic route is absent. Rendering every route per request to
 * fix that would turn one request into hundreds, which is not a trade worth
 * making; the build-time artifact is the complete one.
 *
 * @param {'llms'|'llms-full'} kind
 * @param {Runtime} runtime
 * @param {HtmlFetcher} fetchHtml
 * @param {{ note?: string; concurrency?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function serveLlmsIndex(kind, runtime, fetchHtml, opts = {}) {
  const pages = await collectConcurrently(
    runtime.staticPaths,
    opts.concurrency ?? 8,
    async (pathname) => {
      const html = await fetchHtml(pathname);
      return html === null ? null : pageFromHtml(pathname, html, runtime);
    },
  );

  const home = pages.find((p) => p.pathname === '/');
  const siteMeta = resolveSiteMeta(runtime.config, runtime.site.siteUrl, home?.title ?? '');
  const render = kind === 'llms-full' ? renderLlmsFullTxt : renderLlmsTxt;
  return render(pages, runtime.config, siteMeta, { note: opts.note });
}

/**
 * Map with a bounded number of in-flight tasks, dropping nulls.
 *
 * The previous dev implementation used an unbounded `Promise.all`, which on a
 * large site opened one self-request per route simultaneously against the very
 * server handling the request.
 *
 * @template T
 * @param {string[]} items
 * @param {number} limit
 * @param {(item: string) => Promise<T | null>} run
 * @returns {Promise<T[]>}
 */
export async function collectConcurrently(items, limit, run) {
  /** @type {(T | null)[]} */
  const results = new Array(items.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return /** @type {T[]} */ (results.filter((r) => r !== null));
}

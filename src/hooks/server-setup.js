// @ts-check
import { createTurndown, htmlToMarkdown } from '../lib/html-to-md.js';
import { extractPageMeta, makeTitleStripper } from '../lib/page-meta.js';
import { resolveSiteMeta } from '../config.js';
import { buildRobotsTxt } from '../generators/robots-txt.js';
import { buildDomainProfile } from '../generators/domain-profile.js';
import { renderLlmsTxt, renderLlmsFullTxt } from '../core/render/llms-txt.js';
import { renderMarkdownDocument } from '../core/render/markdown-doc.js';
import { absoluteUrl, mdHrefFor, urlPath } from '../lib/collect.js';
import { isIncluded } from '../lib/match.js';

/**
 * Create a Connect/Vite middleware that serves the AEO text outputs live in
 * `astro dev`. Best-effort: llms.txt / llms-full.txt cover static routes only
 * (dynamic routes need a build), and .md companions are converted on demand by
 * fetching the dev server's own HTML.
 *
 * @param {object} deps
 * @param {import('../index.js').ResolvedAstroAeoConfig} deps.config
 * @param {string} deps.siteUrl
 * @param {string} deps.base
 * @param {'always'|'never'|'ignore'} deps.trailingSlash
 * @param {() => boolean} [deps.isSitemapAvailable]
 * @param {() => string[]} [deps.getStaticPaths]
 * @param {{ warn: (m: string) => void }} deps.logger
 * @returns {(req: any, res: any, next: () => void) => void}
 */
export function createAeoMiddleware(deps) {
  const {
    config,
    siteUrl,
    base,
    trailingSlash,
    isSitemapAvailable = () => false,
    getStaticPaths,
  } = deps;
  const strip = makeTitleStripper(config.pages.stripTitleSuffix);
  const td = createTurndown();
  const basePrefix = base && base !== '/' ? base.replace(/\/$/, '') : '';

  return function aeoMiddleware(req, res, next) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return next();

    // Loop guard. `fetchPage` re-enters the dev server over HTTP with this header,
    // so never handle our own self-fetch: hand it straight to Astro.
    if (req.headers['x-astro-aeo']) return next();

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      return next();
    }
    if (basePrefix && pathname.startsWith(basePrefix)) pathname = pathname.slice(basePrefix.length) || '/';

    // The dev server runs Vite in middleware mode, so derive the origin from the
    // request rather than a listening http.Server.
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const origin = req.headers.host ? `${proto}://${req.headers.host}` : null;

    if (pathname === '/robots.txt' && config.discovery.robots.enabled) {
      const policy = config.discovery.robots.sitemapPolicy;
      const sitemapAvailable = policy === 'always' || (policy === 'auto' && isSitemapAvailable());
      return send(res, 200, 'text/plain; charset=utf-8', buildRobotsTxt(config, siteUrl, base, sitemapAvailable), method);
    }

    if (pathname === '/.well-known/domain-profile.json' && config.site.profile.enabled) {
      const body = JSON.stringify(buildDomainProfile(config, siteUrl), null, 2);
      return send(res, 200, 'application/json; charset=utf-8', body, method);
    }

    if (!origin) return next();

    if (pathname === '/llms.txt' && config.corpus.index.enabled) {
      serveLlmsIndex(origin, false).then((body) => (body == null ? next() : send(res, 200, 'text/plain; charset=utf-8', body, method)), next);
      return;
    }

    if (pathname === '/llms-full.txt' && config.corpus.full.enabled) {
      serveLlmsIndex(origin, true).then((body) => (body == null ? next() : send(res, 200, 'text/plain; charset=utf-8', body, method)), next);
      return;
    }

    if (pathname.endsWith('.md') && config.markdown.enabled) {
      serveMarkdown(origin, pathname).then((body) => (body == null ? next() : send(res, 200, 'text/markdown; charset=utf-8', body, method)), next);
      return;
    }

    return next();
  };

  /**
   * Fetch a page's HTML from the running dev server and collect its meta.
   * @param {string} origin
   * @param {string} pageUrlPath  Page path, e.g. "/about" or "/".
   * @returns {Promise<import('../core/render/llms-txt.js').LlmsPage | null>}
   */
  async function fetchPage(origin, pageUrlPath) {
    // Mirror the build's include/exclude filter (collectPages) so excluded pages
    // are never served as .md or listed in llms.txt during `astro dev`.
    if (!isIncluded(pageUrlPath, { include: config.pages.include, exclude: config.pages.exclude })) return null;
    let html;
    try {
      const resp = await fetch(`${origin}${basePrefix}${urlPath(pageUrlPath, trailingSlash)}`, {
        headers: { 'x-astro-aeo': '1' },
      });
      if (!resp.ok) return null;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('html')) return null;
      html = await resp.text();
    } catch {
      return null;
    }
    const meta = extractPageMeta(html, strip);
    if (meta.isRedirect || meta.aeoTokens.has('skip')) return null;
    if (config.pages.respectNoindex && meta.noindex) return null;
    return {
      pathname: pageUrlPath,
      url: absoluteUrl(siteUrl || origin, base, pageUrlPath, trailingSlash),
      mdHref: mdHrefFor(pageUrlPath, base),
      title: meta.title,
      description: meta.description,
      markdown: htmlToMarkdown(html, td),
      aeoTokens: meta.aeoTokens,
      // Only what the rendered page states. The build additionally falls back to
      // git history, which needs the route-to-source map and the project root;
      // neither is available here, so a page without `article:modified_time` has
      // no date in dev. Documented, and the only remaining build/dev difference.
      lastModified: config.markdown.includeLastModified ? meta.modifiedTime : undefined,
    };
  }

  /**
   * @param {string} origin
   * @param {string} mdPath  Request path ending in ".md".
   * @returns {Promise<string | null>}
   */
  async function serveMarkdown(origin, mdPath) {
    const pagePath = mdPath === '/index.md' ? '/' : mdPath.replace(/\.md$/, '');
    const page = await fetchPage(origin, pagePath);
    if (!page || page.aeoTokens.has('no-dotmd')) return null;
    return renderMarkdownDocument(page, config);
  }

  /**
   * Build llms.txt / llms-full.txt from static routes only.
   * @param {string} origin
   * @param {boolean} full
   * @returns {Promise<string | null>}
   */
  async function serveLlmsIndex(origin, full) {
    const paths = getStaticPaths ? getStaticPaths() : [];
    const results = await Promise.all(paths.map((p) => fetchPage(origin, p)));
    const collected = /** @type {NonNullable<(typeof results)[number]>[]} */ (results.filter(Boolean));
    const home = collected.find((p) => p.pathname === '/');
    const siteMeta = resolveSiteMeta(config, siteUrl, home?.title ?? '');
    const note = '<!-- astro-aeo dev preview: dynamic routes are omitted; run `astro build` for the full file -->';
    const render = full ? renderLlmsFullTxt : renderLlmsTxt;
    return render(collected, config, siteMeta, { note });
  }
}

/**
 * @param {any} res
 * @param {number} status
 * @param {string} contentType
 * @param {string} body
 * @param {string} method
 */
function send(res, status, contentType, body, method) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  if (method === 'HEAD') res.end();
  else res.end(body);
}

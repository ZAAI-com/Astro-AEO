// @ts-check
import { createTurndown, htmlToMarkdown } from '../lib/html-to-md.js';
import { extractPageMeta, makeTitleStripper } from '../lib/page-meta.js';
import { resolveSiteMeta } from '../config.js';
import { buildRobotsTxt } from '../generators/robots-txt.js';
import { buildDomainProfile } from '../generators/domain-profile.js';
import { groupSections } from '../generators/llms-txt.js';

/**
 * Create a Connect/Vite middleware that serves the AEO text outputs live in
 * `astro dev`. Best-effort: llms.txt / llms-full.txt cover static routes only
 * (dynamic routes need a build), and .md companions are converted on demand by
 * fetching the dev server's own HTML.
 *
 * @param {object} deps
 * @param {import('../index.js').ResolvedAeoConfig} deps.config
 * @param {string} deps.siteUrl
 * @param {string} deps.base
 * @param {'always'|'never'|'ignore'} deps.trailingSlash
 * @param {() => string[]} [deps.getStaticPaths]
 * @param {{ warn: (m: string) => void }} deps.logger
 * @returns {(req: any, res: any, next: () => void) => void}
 */
export function createAeoMiddleware(deps) {
  const { config, siteUrl, base, trailingSlash, getStaticPaths } = deps;
  const strip = makeTitleStripper(config.stripTitleSuffix);
  const td = createTurndown();
  const basePrefix = base && base !== '/' ? base.replace(/\/$/, '') : '';

  return function aeoMiddleware(req, res, next) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return next();

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

    if (pathname === '/robots.txt' && config.robotsTxt.enabled) {
      return send(res, 200, 'text/plain; charset=utf-8', buildRobotsTxt(config, siteUrl), method);
    }

    if (pathname === '/.well-known/domain-profile.json' && config.domainProfile.enabled) {
      const body = JSON.stringify(buildDomainProfile(config, siteUrl), null, 2);
      return send(res, 200, 'application/json; charset=utf-8', body, method);
    }

    if (!origin) return next();

    if (pathname === '/llms.txt' && config.llmsTxt.enabled) {
      serveLlmsIndex(origin, false).then((body) => (body == null ? next() : send(res, 200, 'text/plain; charset=utf-8', body, method)), next);
      return;
    }

    if (pathname === '/llms-full.txt' && config.llmsFullTxt.enabled) {
      serveLlmsIndex(origin, true).then((body) => (body == null ? next() : send(res, 200, 'text/plain; charset=utf-8', body, method)), next);
      return;
    }

    if (pathname.endsWith('.md') && config.dotmd.enabled) {
      serveMarkdown(origin, pathname).then((body) => (body == null ? next() : send(res, 200, 'text/markdown; charset=utf-8', body, method)), next);
      return;
    }

    return next();
  };

  /**
   * Fetch a page's HTML from the running dev server and collect its meta.
   * @param {string} origin
   * @param {string} pageUrlPath  Page path, e.g. "/about" or "/".
   * @returns {Promise<{ pathname: string; url: string; title: string; description: string; markdown: string; aeoTokens: Set<string> } | null>}
   */
  async function fetchPage(origin, pageUrlPath) {
    const urlPath = pageUrlPath === '/' ? '/' : trailingSlash === 'never' ? pageUrlPath : `${pageUrlPath}/`;
    let html;
    try {
      const resp = await fetch(`${origin}${basePrefix}${urlPath}`, { headers: { 'x-astro-aeo': '1' } });
      if (!resp.ok) return null;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('html')) return null;
      html = await resp.text();
    } catch {
      return null;
    }
    const meta = extractPageMeta(html, strip);
    if (meta.isRedirect || meta.aeoTokens.has('skip')) return null;
    if (config.respectNoindex && meta.noindex) return null;
    return {
      pathname: pageUrlPath,
      url: `${siteUrl || origin}${urlPath}`,
      title: meta.title,
      description: meta.description,
      markdown: htmlToMarkdown(html, td),
      aeoTokens: meta.aeoTokens,
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
    let body = '';
    if (config.dotmd.frontmatter) {
      body += '---\n';
      body += `title: ${JSON.stringify(page.title)}\n`;
      body += `url: ${page.url}\n`;
      if (page.description) body += `description: ${JSON.stringify(page.description)}\n`;
      body += '---\n\n';
    }
    return `${body}${page.markdown}\n`;
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
    const { name, description } = resolveSiteMeta(config, siteUrl, home?.title ?? '');
    const note = '<!-- astro-aeo dev preview: dynamic routes are omitted; run `astro build` for the full file -->';

    if (full) {
      const eligible = collected.filter((p) => !p.aeoTokens.has('no-llms') && !p.aeoTokens.has('no-llms-full'));
      const lines = [`# ${name}`, ''];
      if (description) lines.push(`> ${description}`, '');
      lines.push(note, '', '---', '');
      for (const p of eligible) {
        lines.push(`# ${p.title}`, '');
        lines.push(`URL: ${p.url}`);
        if (p.description) lines.push(`Description: ${p.description}`);
        lines.push('', p.markdown, '', '---', '');
      }
      return lines.join('\n');
    }

    const eligible = collected.filter((p) => !p.aeoTokens.has('no-llms'));
    const groups = groupSections(
      /** @type {any} */ (eligible),
      config.llmsTxt.sections,
      config.llmsTxt.defaultSection,
    );
    const lines = [`# ${name}`, ''];
    if (description) lines.push(`> ${description}`, '');
    lines.push(note, '');
    for (const group of groups) {
      lines.push(`## ${group.title}`, '');
      for (const p of group.pages) {
        let line = `- [${p.title}](${basePrefix}${p.pathname === '/' ? '/index.md' : `${p.pathname}.md`})`;
        if (config.llmsTxt.includeDescriptions && p.description) line += `: ${p.description}`;
        lines.push(line);
      }
      lines.push('');
    }
    return lines.join('\n');
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

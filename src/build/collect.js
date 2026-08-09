// @ts-check
import { join } from 'node:path';
import { isAbsolute, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTurndown } from '../core/html-to-md.js';
import { makeTitleStripper } from '../core/page-meta.js';
import { buildPage, mdPathnameFor, toIsoTimestamp } from '../core/page-model.js';
import { createDistHtmlSource } from '../sources/dist-html.js';
import { getGitLastModified } from '../lib/git-mtime.js';
import { normalizePath } from '../core/match.js';

/**
 * @typedef {import('../core/page-model.js').BuildPage} BuildPage
 * @typedef {import('../core/page-model.js').AeoPage} AeoPage
 */

/** @typedef {BuildPage} PageInfo */

/**
 * @typedef {object} CollectContext
 * @property {URL} distDir
 * @property {string} siteUrl              Site origin without trailing slash.
 * @property {string} base                 Astro base path (e.g. "" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 * @property {'directory'|'file'} buildFormat
 * @property {string} projectRoot          Absolute project root (for git mtime).
 * @property {Map<string, string>} routeEntrypoints  Normalized pathname -> source entrypoint.
 * @property {{ warn: (m: string) => void }} logger
 */

/**
 * @param {import('../page.js').PageDescriptor[]} rawPages
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {CollectContext} ctx
 * @returns {Promise<BuildPage[]>}
 */
export async function collectPages(rawPages, config, ctx) {
  const source = createDistHtmlSource({ distDir: ctx.distDir, buildFormat: ctx.buildFormat });
  const strip = makeTitleStripper(config.pages.stripTitleSuffix);
  /** @type {Promise<import('turndown')> | undefined} */
  let td;
  const getTurndown = () => (td ??= createTurndown());
  const site = { siteUrl: ctx.siteUrl, base: ctx.base, trailingSlash: ctx.trailingSlash };
  /** @type {BuildPage[]} */
  const pages = [];

  for (const raw of rawPages) {
    const pathname = normalizePath(raw.pathname || '/');

    const read = source.read(pathname);
    const authored = authoredSource(raw, pathname, ctx);
    if (!read && authored?.markdown === undefined) {
      ctx.logger.warn(`astro-aeo: could not read built HTML for ${pathname}, skipping`);
      continue;
    }

    const result = await buildPage({
      pathname,
      html: read?.html ?? descriptorDocument(raw),
      config,
      site,
      getTurndown,
      strip,
      authored,
      rendering: raw.rendering ?? 'prerendered',
    });
    if ('skip' in result) continue;

    pages.push({
      ...result.page,
      htmlPath: read?.htmlPath ?? '',
      mdPath: join(source.root, mdPathnameFor(pathname)),
      lastModified:
        result.page.lastModified ??
        toIsoTimestamp(raw.lastModified) ??
        gitLastModified(pathname, config, ctx),
    });
  }

  return pages;
}

/**
 * @param {import('../page.js').PageDescriptor} descriptor
 * @param {string} pathname
 * @param {CollectContext} ctx
 * @returns {{ markdown?: string; title?: string; description?: string; lastModified?: string; path?: string; strategy?: 'markdown-route'|'catalog'; extraction?: import('../core/extract/index.js').ExtractionDiagnostics } | undefined}
 */
function authoredSource(descriptor, pathname, ctx) {
  const catalogMarkdown =
    typeof descriptor.markdown === 'string'
      ? descriptor.markdown
      : typeof descriptor.source?.body === 'string'
        ? descriptor.source.body
        : undefined;
  const entrypoint = ctx.routeEntrypoints.get(pathname);
  let routeMarkdown;
  if (entrypoint && entrypoint.replace(/[?#].*$/, '').endsWith('.md')) {
    const cleaned = entrypoint.replace(/[?#].*$/, '');
    const path = cleaned.startsWith('file:')
      ? fileURLToPath(cleaned)
      : isAbsolute(cleaned)
        ? cleaned
        : resolve(ctx.projectRoot, cleaned);
    try {
      routeMarkdown = stripLeadingFrontmatter(readFileSync(path, 'utf8'));
    } catch (error) {
      ctx.logger.warn(
        `astro-aeo: could not read Markdown source for ${pathname}; rendered extraction was used: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const hasCatalogFacts =
    catalogMarkdown !== undefined ||
    descriptor.title !== undefined ||
    descriptor.description !== undefined ||
    descriptor.lastModified !== undefined ||
    descriptor.sourcePath !== undefined ||
    descriptor.source?.path !== undefined ||
    descriptor.extraction !== undefined;
  if (!hasCatalogFacts && routeMarkdown === undefined) return undefined;

  return {
    ...(catalogMarkdown !== undefined
      ? { markdown: catalogMarkdown }
      : routeMarkdown !== undefined
        ? { markdown: routeMarkdown }
        : {}),
    ...(descriptor.title !== undefined ? { title: descriptor.title } : {}),
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    ...(descriptor.lastModified !== undefined ? { lastModified: descriptor.lastModified } : {}),
    ...(descriptor.sourcePath || descriptor.source?.path || entrypoint
      ? { path: descriptor.sourcePath ?? descriptor.source?.path ?? entrypoint }
      : {}),
    ...(descriptor.extraction ? { extraction: descriptor.extraction } : {}),
    strategy: catalogMarkdown !== undefined ? 'catalog' : routeMarkdown !== undefined ? 'markdown-route' : 'catalog',
  };
}

/** @param {string} markdown @returns {string} */
export function stripLeadingFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return markdown;
  return markdown.replace(/^---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/, '');
}

/** @param {import('../page.js').PageDescriptor} descriptor @returns {string} */
function descriptorDocument(descriptor) {
  const title = escapeHtml(descriptor.title ?? descriptor.pathname);
  const description = descriptor.description
    ? `<meta name="description" content="${escapeHtml(descriptor.description)}">`
    : '';
  return `<!doctype html><html><head><title>${title}</title>${description}</head><body><main></main></body></html>`;
}

/** @param {string} value @returns {string} */
function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {CollectContext} ctx
 * @returns {string | undefined}
 */
function gitLastModified(pathname, config, ctx) {
  if (!config.markdown.includeLastModified) return undefined;
  const entry = ctx.routeEntrypoints.get(pathname);
  if (!entry) return undefined;
  return toIsoTimestamp(
    getGitLastModified(join(ctx.projectRoot, entry), { cwd: ctx.projectRoot }),
  );
}

export { absoluteUrl, mdHrefFor, urlPath } from '../core/page-model.js';
export { resolveHtmlPath } from '../sources/dist-html.js';

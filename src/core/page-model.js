// @ts-check
import { createTurndown } from './html-to-md.js';
import { extractMarkdown } from './extract/index.js';
import { extractMetaContent, extractPageMeta, makeTitleStripper } from './page-meta.js';
import { isIncluded, normalizePath } from './match.js';
import { parseDocument } from './html-document.js';
import { readMarker, removeMarkers, stripMarkersFromHtml } from './extract/marker.js';
import { authoredCanonical, configuredCanonical, stableCanonical } from './canonical.js';
import { resolveMarkdownWithRenderers } from './markdown-renderers.js';
import { sourceKindFor } from './source-kind.js';

/**
 * @typedef {object} SiteFacts
 * @property {string} siteUrl                          Origin without a trailing slash.
 * @property {string} [stableSiteUrl]                  Configured Astro site only.
 * @property {string} base                             Astro base path ("" or "/docs").
 * @property {'always'|'never'|'ignore'} trailingSlash
 */

/**
 * @typedef {object} AeoPageRecord
 * @property {string} id
 * @property {string} pathname       Normalized: leading slash, no trailing slash except root.
 * @property {string} [routePattern]
 * @property {string} url            Absolute URL, honouring base and trailingSlash.
 * @property {string} [canonicalUrl]
 * @property {string} [markdownUrl]
 * @property {string} [origin]
 * @property {string} [locale]
 * @property {string} [language]
 * @property {{ language: string; url: string }[]} [alternates]
 * @property {boolean} [corpusExcluded] Internal corpus-planning exclusion marker.
 * @property {{ initial?: string; declared?: string; rendered?: string; siteDefault?: string }} [languageSources] Internal precedence inputs.
 * @property {{ title: string; description?: string; image?: string; canonicalSource?: 'authored'|'inferred' }} metadata
 * @property {{ html?: string; markdown?: string; plainText?: string }} representations
 * @property {{ published?: string; modified?: string }} [dates]
 * @property {import('../schema.js').EntityReference[]} authors
 * @property {import('../schema.js').SchemaEntity[]} entities
 * @property {{ index: boolean; includeInLlms: boolean; includeInLlmsFull: boolean; generateMarkdown: boolean }} directives
 * @property {string} mdHref         Root-relative, base-prefixed href to the .md companion.
 * @property {string} title
 * @property {string} description
 * @property {string} markdown
 * @property {'prerendered'|'on-demand'} rendering
 * @property {string} [lastModified]  ISO timestamp when known.
 * @property {string[]} aeoTokens
 * @property {import('./extract/index.js').ExtractionDiagnostics} [extraction]
 * @property {{ kind: 'markdown'|'mdx'|'astro'|'cms'|'rendered'|'custom'; strategy?: 'marker'|'markdown-route'|'rendered'|'catalog'; path?: string; body?: string; hash?: string }} source
 * @property {import('../index.js').Diagnostic[]} diagnostics
 */

/** @typedef {AeoPageRecord} AeoPage  Compatibility alias for existing internal imports. */

/**
 * A page plus the filesystem locations only a build has.
 * @typedef {AeoPageRecord & { htmlPath: string; mdPath: string }} BuildPage
 */

/** Why a page produced no record. Every branch is reported, never silently dropped. */
/** @typedef {'excluded'|'redirect'|'noindex'|'skip-token'} SkipReason */

/**
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function urlPath(pathname, trailingSlash) {
  if (pathname === '/') return '/';
  return trailingSlash === 'never' ? pathname : `${pathname}/`;
}

/**
 * @param {string} origin  Site origin (or dev origin) without a trailing slash.
 * @param {string} base
 * @param {string} pathname
 * @param {'always'|'never'|'ignore'} trailingSlash
 * @returns {string}
 */
export function absoluteUrl(origin, base, pathname, trailingSlash) {
  return `${origin}${basePrefix(base)}${urlPath(pathname, trailingSlash)}`;
}

/**
 * @param {string} pathname
 * @param {string} [base]
 * @returns {string}
 */
export function mdHrefFor(pathname, base = '') {
  return `${basePrefix(base)}${mdPathnameFor(pathname)}`;
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function mdPathnameFor(pathname) {
  return pathname === '/' ? '/index.md' : `${pathname}.md`;
}

/**
 * @param {string} mdPathname
 * @returns {string | null}
 */
export function pagePathForMdPath(mdPathname) {
  if (!mdPathname.endsWith('.md')) return null;
  if (mdPathname === '/index.md') return '/';
  return normalizePath(mdPathname.slice(0, -'.md'.length));
}

/**
 * @param {string} base
 * @returns {string}
 */
export function basePrefix(base) {
  return base && base !== '/' ? base.replace(/\/$/, '') : '';
}

/**
 * @param {object} input
 * @param {string} input.pathname
 * @param {string} input.html
 * @param {import('../index.js').ResolvedAstroAeoConfig} input.config
 * @param {SiteFacts} input.site
 * @param {import('turndown')} [input.td]
 * @param {() => Promise<import('turndown')>} [input.getTurndown]
 * @param {{ markdown?: string; body?: string; title?: string; description?: string; image?: string; language?: string; published?: string; lastModified?: string; authors?: unknown[]; entities?: unknown[]; directives?: Partial<Record<'index'|'includeInLlms'|'includeInLlmsFull'|'generateMarkdown', boolean>>; kind?: 'markdown'|'mdx'|'astro'|'cms'|'rendered'|'custom'; path?: string; hash?: string; strategy?: 'markdown-route'|'catalog'; extraction?: import('./extract/index.js').ExtractionDiagnostics }} [input.authored]
 * @param {import('./markdown-renderers.js').MarkdownRendererEntry[]} [input.renderers]
 * @param {boolean} [input.allowMarker]
 * @param {'prerendered'|'on-demand'} [input.rendering]
 * @param {string} [input.publicPathname] URL-encoded pathname used for emitted links.
 * @param {string} [input.routePattern]
 * @param {(title: string) => string} [input.strip]  Reused instance; derived from config when absent.
 * @returns {Promise<{ page: AeoPage } | { skip: SkipReason }>}
 */
export async function buildPage({ pathname: rawPathname, html, config, site, td, getTurndown, authored, renderers = [], allowMarker = true, rendering = 'on-demand', publicPathname, routePattern, strip }) {
  const pathname = normalizePath(rawPathname || '/');
  const emittedPathname = normalizePath(publicPathname ?? pathname);

  if (!isIncluded(pathname, { include: config.pages.include, exclude: config.pages.exclude })) {
    return { skip: 'excluded' };
  }

  const meta = extractPageMeta(html, strip ?? makeTitleStripper(config.pages.stripTitleSuffix));
  if (meta.isRedirect) return { skip: 'redirect' };
  if (config.pages.respectNoindex && meta.noindex) return { skip: 'noindex' };
  if (meta.aeoTokens.has('skip')) return { skip: 'skip-token' };

  const url = absoluteUrl(site.siteUrl, site.base, emittedPathname, site.trailingSlash);

  const document = parseDocument(html);
  const marker = allowMarker ? readMarker(document) : null;
  removeMarkers(document);
  const cleanHtml = stripMarkersFromHtml(html);
  const stableSiteFacts = { ...site, siteUrl: site.stableSiteUrl ?? site.siteUrl };
  const configured = configuredCanonical(stableSiteFacts, emittedPathname);
  const stableSite = stableCanonical(site.stableSiteUrl ?? site.siteUrl);
  const authoredLink = authoredCanonical(cleanHtml, configured ?? stableSite);
  const canonicalUrl = authoredLink.canonical ?? configured;

  const authoredMarkdown = typeof authored?.markdown === 'string' ? authored.markdown : undefined;
  const markerMarkdown = typeof marker?.markdown === 'string' ? marker.markdown : undefined;
  const markerWins = markerMarkdown !== undefined;
  const authoredWins = !markerWins && authoredMarkdown !== undefined;
  const sourceMarkdown = markerMarkdown ?? authoredMarkdown;
  let markdown = '';
  /** @type {import('./extract/index.js').ExtractionDiagnostics | undefined} */
  let extraction = authoredWins ? authored?.extraction : undefined;
  /** @type {import('../index.js').Diagnostic[]} */
  const rendererDiagnostics = [];
  let rendererWins = false;
  if (sourceMarkdown !== undefined) {
    markdown = sourceMarkdown;
  } else {
    if (renderers.length > 0) {
      const rendered = await resolveMarkdownWithRenderers(renderers, {
        pathname,
        html: document.toString(),
        ...(canonicalUrl ? { canonicalUrl } : {}),
        ...(routePattern ? { routePattern } : {}),
        rendering,
        ...(authored?.kind
          ? {
              source: {
                kind: authored.kind,
                ...(authored.path ? { path: authored.path } : {}),
                ...(typeof authored.body === 'string' ? { body: authored.body } : {}),
                ...(typeof authored.hash === 'string' ? { hash: authored.hash } : {}),
              },
            }
          : {}),
        extraction: config.markdown.extraction,
      });
      rendererDiagnostics.push(...rendered.diagnostics);
      if (rendered.status === 'rendered') {
        markdown = rendered.markdown ?? '';
        extraction = rendered.extraction;
        rendererWins = true;
      }
    }
    if (!rendererWins) {
      const extracted = extractMarkdown(
        document,
        config.markdown.extraction,
        td ?? (await (getTurndown ?? createTurndown)()),
        { baseUrl: url },
      );
      markdown = extracted.markdown;
      extraction = extracted.diagnostics;
    }
  }

  const title = marker?.title || authored?.title || meta.title;
  const description = marker?.description || authored?.description || meta.description;
  const image = marker?.image || authored?.image || extractMetaContent(cleanHtml, { property: 'og:image' });
  const declaredLanguage = marker?.language || authored?.language || undefined;
  const renderedLanguage = document.documentElement?.getAttribute('lang') || undefined;
  const language = declaredLanguage || renderedLanguage || config.site.defaultLocale;
  const published = toIsoTimestamp(marker?.published) ?? toIsoTimestamp(authored?.published);
  const modified =
    toIsoTimestamp(marker?.lastModified) ??
    toIsoTimestamp(authored?.lastModified) ??
    toIsoTimestamp(meta.modifiedTime);
  const markerDirectives = marker?.directives ?? {};
  const authoredDirectives = authored?.directives ?? {};
  /**
   * @param {'index'|'includeInLlms'|'includeInLlmsFull'|'generateMarkdown'} key
   * @param {boolean} fallback
   */
  const directive = (key, fallback) =>
    typeof markerDirectives[key] === 'boolean'
      ? markerDirectives[key]
      : typeof authoredDirectives[key] === 'boolean'
        ? authoredDirectives[key]
        : fallback;
  const sourcePath = typeof marker?.sourcePath === 'string' && marker.sourcePath
    ? marker.sourcePath
    : authored?.path;
  const kind = marker?.sourceKind ?? authored?.kind ?? sourceKindFor(sourcePath, sourceMarkdown !== undefined);
  const mdHref = mdHrefFor(emittedPathname, site.base);
  const markdownUrl = stableSite ? new URL(mdHref, stableSite).href : undefined;
  const authors = Array.isArray(marker?.authors)
    ? marker.authors
    : Array.isArray(authored?.authors)
      ? authored.authors
      : [];
  const entities = Array.isArray(marker?.entities)
    ? marker.entities
    : Array.isArray(authored?.entities)
      ? authored.entities
      : [];

  return {
    page: {
      id: pathname,
      pathname,
      ...(routePattern ? { routePattern } : {}),
      url,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(markdownUrl ? { markdownUrl } : {}),
      ...(language ? { language } : {}),
      languageSources: {
        ...(language ? { initial: language } : {}),
        ...(declaredLanguage ? { declared: declaredLanguage } : {}),
        ...(renderedLanguage ? { rendered: renderedLanguage } : {}),
        ...(config.site.defaultLocale ? { siteDefault: config.site.defaultLocale } : {}),
      },
      metadata: {
        title,
        ...(description ? { description } : {}),
        ...(image ? { image } : {}),
        ...(canonicalUrl
          ? { canonicalSource: authoredLink.canonical ? /** @type {const} */ ('authored') : /** @type {const} */ ('inferred') }
          : {}),
      },
      representations: {
        html: cleanHtml,
        markdown,
        plainText: documentPlainText(document),
      },
      ...(published || modified
        ? { dates: { ...(published ? { published } : {}), ...(modified ? { modified } : {}) } }
        : {}),
      authors: /** @type {import('../schema.js').EntityReference[]} */ (authors),
      entities: /** @type {import('../schema.js').SchemaEntity[]} */ (entities),
      directives: {
        index: directive('index', !meta.noindex),
        includeInLlms: directive('includeInLlms', !meta.aeoTokens.has('no-llms')),
        includeInLlmsFull: directive('includeInLlmsFull', !meta.aeoTokens.has('no-llms-full')),
        generateMarkdown: directive('generateMarkdown', !meta.aeoTokens.has('no-dotmd')),
      },
      mdHref,
      title,
      description,
      markdown,
      rendering,
      ...(modified ? { lastModified: modified } : {}),
      aeoTokens: [...meta.aeoTokens],
      ...(extraction ? { extraction } : {}),
      source: {
        kind,
        strategy: markerWins
          ? 'marker'
          : authoredWins
            ? authored?.strategy ?? 'markdown-route'
            : rendererWins && authored?.strategy
              ? authored.strategy
              : 'rendered',
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(typeof authored?.hash === 'string' ? { hash: authored.hash } : {}),
      },
      diagnostics: [
        ...rendererDiagnostics,
        ...(authoredLink.conflict
          ? [{
            version: /** @type {const} */ (1),
            code: 'canonical-conflict',
            severity: /** @type {const} */ ('warning'),
            message: 'Multiple valid authored canonical URLs were found; the configured site canonical was used when available.',
            pathname,
          }]
          : []),
      ],
    },
  };
}

/** @param {Document} document */
function documentPlainText(document) {
  if (!document.body) return '';
  const body = /** @type {HTMLElement} */ (document.body.cloneNode(true));
  for (const element of body.querySelectorAll('script,style,noscript,template,iframe')) {
    element.remove();
  }
  for (const element of body.querySelectorAll(
    'address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul',
  )) {
    element.appendChild(document.createTextNode(' '));
  }
  return (body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Date | string | undefined} value
 * @returns {string | undefined}
 */
export function toIsoTimestamp(value) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

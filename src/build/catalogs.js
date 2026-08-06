// @ts-check
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCatalogPathname, normalizePath } from '../core/match.js';
import { toIsoTimestamp } from '../core/page-model.js';

/**
 * Loading the page catalogs a project configured.
 *
 * Build-only, and deliberately not part of `astro-aeo/page`: that subpath is the
 * public surface a page imports, and it should stay `defineAeoPage` plus types.
 */

/** @typedef {{ module: string; specifier: string; namespace: any }} LoadedCatalogModule */

/**
 * Vite executes Astro integrations through a module runner and rewrites direct
 * dynamic imports. Some adapters close that runner before `config:done`, so use
 * an indirect native import for project-owned catalog modules.
 */
const nativeImport = /** @type {(specifier: string) => Promise<any>} */ (
  new Function('specifier', 'return import(specifier)')
);

/** @param {string} specifier @returns {Promise<any>} */
export function importCatalogModule(specifier) {
  return nativeImport(specifier);
}

/**
 * Resolve a catalog the same way for preflight, build collection, and runtime
 * bundling. Relative modules belong to the Astro project root; bare specifiers
 * remain package imports.
 * @param {string} specifier
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveCatalogSpecifier(specifier, projectRoot) {
  return specifier.startsWith('.')
    ? pathToFileURL(resolve(projectRoot, specifier)).href
    : specifier;
}

/**
 * Import catalogs before Vite creates the runtime graph. A module that cannot
 * resolve, parse, or evaluate is omitted from that graph and cannot fail a
 * consumer's server build or startup.
 * @param {{ module: string }[]} catalogs
 * @param {string} projectRoot
 * @param {{ warn: (m: string) => void }} logger
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @param {(specifier: string) => Promise<any>} [load]
 * @returns {Promise<LoadedCatalogModule[]>}
 */
export async function preloadCatalogModules(
  catalogs,
  projectRoot,
  logger,
  diagnostics = [],
  load = importCatalogModule,
) {
  /** @type {LoadedCatalogModule[]} */
  const loaded = [];
  for (const catalog of catalogs) {
    const specifier = resolveCatalogSpecifier(catalog.module, projectRoot);
    try {
      loaded.push({
        module: catalog.module,
        specifier,
        namespace: await load(specifier),
      });
    } catch (error) {
      reportCatalogDiagnostic(diagnostics, logger, {
        code: 'catalog-load-failed',
        message: `astro-aeo: the page catalog "${catalog.module}" failed to load, so it contributed nothing: ${
          error instanceof Error ? error.message : String(error)
        }`,
        sourcePath: catalog.module,
      });
    }
  }
  return loaded;
}

/**
 * Load the configured page catalogs.
 *
 * A catalog lists pages the build cannot see for itself, which is every route
 * generated from data rather than from a file. Without one, a dynamic route is
 * simply absent from the corpus; astro-aeo does not crawl to find them.
 *
 * @param {{ module: string }[]} catalogs
 * @param {(specifier: string) => Promise<any>} load
 * @param {{ warn: (m: string) => void }} logger
 * @param {import('../page.js').CatalogContext} context
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @returns {Promise<import('../page.js').PageDescriptor[]>}
 */
export async function loadCatalogPages(catalogs, load, logger, context, diagnostics = []) {
  /** @type {import('../page.js').PageDescriptor[]} */
  const pages = [];
  const seen = new Set();
  for (const catalog of catalogs) {
    try {
      const mod = await load(catalog.module);
      const impl = mod?.default ?? mod;
      if (typeof impl?.listPages !== 'function') {
        reportCatalogDiagnostic(diagnostics, logger, {
          code: 'catalog-missing-list-pages',
          message: `astro-aeo: the page catalog "${catalog.module}" has no listPages() export, so it contributed nothing.`,
          sourcePath: catalog.module,
        });
        continue;
      }
      const listed = await impl.listPages(context);
      for (const entry of Array.isArray(listed) ? listed : []) {
        const pathname = normalizeCatalogPathname(entry?.pathname);
        if (pathname !== null) {
          if (seen.has(pathname)) {
            reportCatalogDiagnostic(diagnostics, logger, {
              code: 'catalog-path-conflict',
              message: `astro-aeo: more than one page catalog described ${pathname}; the first descriptor wins.`,
              pathname,
              sourcePath: catalog.module,
            });
            continue;
          }
          seen.add(pathname);
          const lastModified = toIsoTimestamp(entry.lastModified);
          if (entry.lastModified && !lastModified) {
            reportCatalogDiagnostic(diagnostics, logger, {
              code: 'catalog-invalid-last-modified',
              message: `astro-aeo: catalog page ${pathname} has an invalid lastModified value and it was ignored.`,
              pathname,
              sourcePath: catalog.module,
            });
          }
          pages.push({
            pathname,
            ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
            ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
            ...(typeof entry.markdown === 'string' ? { markdown: entry.markdown } : {}),
            ...(lastModified ? { lastModified } : {}),
            ...(typeof entry.sourcePath === 'string' ? { sourcePath: entry.sourcePath } : {}),
            ...(entry.source && typeof entry.source === 'object' ? { source: entry.source } : {}),
            ...(entry.extraction && typeof entry.extraction === 'object'
              ? { extraction: entry.extraction }
              : {}),
            ...(entry.rendering === 'prerendered' || entry.rendering === 'on-demand'
              ? { rendering: entry.rendering }
              : {}),
            ...(typeof entry.routePattern === 'string' ? { routePattern: entry.routePattern } : {}),
          });
        } else {
          reportCatalogDiagnostic(diagnostics, logger, {
            code: 'catalog-invalid-pathname',
            message: `astro-aeo: the page catalog "${catalog.module}" returned an unsafe or non-root-relative pathname, so it was ignored.`,
            sourcePath: catalog.module,
          });
        }
      }
    } catch (err) {
      reportCatalogDiagnostic(diagnostics, logger, {
        code: 'catalog-load-failed',
        message: `astro-aeo: the page catalog "${catalog.module}" failed to load, so it contributed nothing: ${
          err instanceof Error ? err.message : String(err)
        }`,
        sourcePath: catalog.module,
      });
    }
  }
  return pages;
}

/**
 * @param {import('../index.js').Diagnostic[]} diagnostics
 * @param {{ warn: (m: string) => void }} logger
 * @param {{ code: string; message: string; pathname?: string; sourcePath?: string }} finding
 */
function reportCatalogDiagnostic(diagnostics, logger, finding) {
  logger.warn(finding.message);
  diagnostics.push({ version: 1, severity: 'warning', ...finding });
}

/**
 * Enrich concrete routes with descriptors, then append catalog-only routes.
 * Concrete discovery owns the route; a descriptor supplies facts Astro does not.
 * @param {{ pathname: string }[]} concrete
 * @param {import('../page.js').PageDescriptor[]} catalog
 * @returns {import('../page.js').PageDescriptor[]}
 */
export function mergeCatalogPages(concrete, catalog) {
  const merged = new Map();
  for (const page of concrete) {
    const pathname = normalizePath(page.pathname || '/');
    if (!merged.has(pathname)) merged.set(pathname, { ...page, pathname });
  }
  for (const descriptor of catalog) {
    const pathname = normalizeCatalogPathname(descriptor.pathname);
    if (pathname === null) continue;
    merged.set(pathname, { ...(merged.get(pathname) ?? {}), ...descriptor, pathname });
  }
  return [...merged.values()];
}

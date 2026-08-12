// @ts-check
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredCanonical } from '../core/canonical.js';
import { parseSitemapXml } from '../core/sitemap-xml.js';

/**
 * @typedef {object} SitemapFinding
 * @property {string} code
 * @property {'warning'|'error'} severity
 * @property {string} message
 * @property {string} [pathname]
 * @property {string} [sourcePath]
 */

/**
 * Validate a local sitemap and every confined local shard it references.
 * References are never fetched. An index can only traverse regular,
 * non-symlink files beneath `distDir` on the configured origin.
 *
 * @param {{
 *   distDir: URL | string;
 *   entryPath: string;
 *   siteUrl?: string;
 *   base?: string;
 *   routePaths?: Iterable<string>;
 *   runtimeUrls?: Iterable<string>;
 * }} input
 * @returns {{ valid: boolean; findings: SitemapFinding[]; documentsChecked: number; urls: string[] }}
 */
export function validateLocalSitemap(input) {
  const root = input.distDir instanceof URL ? fileURLToPath(input.distDir) : resolve(input.distDir);
  const base = normalizeBase(input.base ?? '');
  const expectedOrigin = normalizeOrigin(input.siteUrl);
  let documentOrigin = expectedOrigin;
  /** @type {SitemapFinding[]} */
  const findings = [];
  /** @type {Map<string, { canonical?: string; route: string }>} */
  const staticPages = discoverStaticPages(root, expectedOrigin, base);
  const routePaths = new Set([
    ...staticPages.keys(),
    ...[...(input.routePaths ?? [])].map((route) => normalizeRoute(withBase(route, base))),
  ]);
  const runtimeUrls = new Set([...(input.runtimeUrls ?? [])].flatMap((value) => {
    const url = safeHttpUrl(value);
    return url ? [url.href] : [];
  }));
  const seenDocuments = new Set();
  const seenLocations = new Set();
  const seenUrls = new Set();
  const seenRouteUrls = new Map();
  /** @type {{ loc: string; alternates: { language: string; url: string }[]; sourcePath: string }[]} */
  const entries = [];

  const entryFile = resolveRootPath(root, input.entryPath, '');
  if (!entryFile) {
    findings.push(finding('sitemap-path-invalid', 'error', `Sitemap path is not a confined root-relative path: ${input.entryPath}`, input.entryPath));
    return finish();
  }

  visit(entryFile, normalizeServedPath(input.entryPath));

  const knownUrls = new Map(entries.map((entry) => [entry.loc, entry]));
  for (const entry of entries) {
    for (const alternate of entry.alternates) {
      const target = knownUrls.get(alternate.url);
      if (!target) {
        const alternateUrl = safeHttpUrl(alternate.url);
        if (
          alternateUrl &&
          documentOrigin &&
          alternateUrl.origin === documentOrigin &&
          routePaths.has(normalizeRoute(alternateUrl.pathname))
        ) {
          findings.push(finding(
            'sitemap-hreflang-not-reciprocal',
            'error',
            `Alternate ${alternate.url} is a known local page but has no reciprocal sitemap entry for ${entry.loc}.`,
            undefined,
            entry.sourcePath,
          ));
        }
        continue;
      }
      if (!target.alternates.some((candidate) => candidate.url === entry.loc)) {
        findings.push(finding(
          'sitemap-hreflang-not-reciprocal',
          'error',
          `Alternate ${alternate.url} does not link back to ${entry.loc}.`,
          undefined,
          entry.sourcePath,
        ));
      }
    }
  }

  return finish();

  /** @param {string} file @param {string} servedPath */
  function visit(file, servedPath) {
    const key = resolve(file);
    if (seenDocuments.has(key)) {
      findings.push(finding('sitemap-index-cycle', 'error', `Sitemap index cycle detected at ${servedPath}.`, servedPath));
      return;
    }
    if (!confinedRegularFile(root, file)) {
      findings.push(finding('sitemap-reference-missing', 'error', `Sitemap file is missing or is not a regular non-symlink file: ${servedPath}`, servedPath));
      return;
    }
    seenDocuments.add(key);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error) {
      findings.push(finding('sitemap-read-failed', 'error', `Could not read ${servedPath}: ${errorMessage(error)}`, servedPath));
      return;
    }
    const parsed = parseSitemapXml(source);
    for (const issue of parsed.findings) {
      findings.push(finding(issue.code, 'error', issue.message, servedPath));
    }
    if (parsed.kind === 'index') {
      for (const location of parsed.locations) {
        const candidate = safeHttpUrl(location);
        if (!documentOrigin && candidate) documentOrigin = candidate.origin;
        const url = localReference(location, documentOrigin, base);
        if (!url) {
          findings.push(finding(
            'sitemap-reference-not-local',
            'error',
            `Sitemap index reference is not a confined same-origin URL: ${redactUrl(location)}`,
            servedPath,
          ));
          continue;
        }
        if (seenLocations.has(url.href)) {
          findings.push(finding('sitemap-reference-duplicate', 'error', `Duplicate sitemap index reference: ${url.href}`, servedPath));
          continue;
        }
        seenLocations.add(url.href);
        const child = resolveRootPath(root, url.pathname, base);
        if (!child) {
          findings.push(finding('sitemap-reference-escape', 'error', `Sitemap reference escapes the build output: ${url.pathname}`, servedPath));
          continue;
        }
        visit(child, url.pathname);
      }
      return;
    }
    if (parsed.kind !== 'urlset') return;

    for (const entry of parsed.urls) {
      const canonical = safeHttpUrl(entry.loc);
      if (!canonical || canonical.username || canonical.password || canonical.hash || canonical.search) {
        findings.push(finding('sitemap-url-invalid', 'error', `Invalid canonical sitemap URL: ${redactUrl(entry.loc)}`, servedPath));
        continue;
      }
      if (!documentOrigin) documentOrigin = canonical.origin;
      if (documentOrigin && canonical.origin !== documentOrigin) {
        findings.push(finding('sitemap-url-origin', 'error', `Sitemap URL uses an unexpected origin: ${canonical.origin}`, servedPath));
        continue;
      }
      if (seenUrls.has(canonical.href)) {
        findings.push(finding('sitemap-url-duplicate', 'error', `Duplicate sitemap URL: ${canonical.href}`, servedPath));
        continue;
      }
      seenUrls.add(canonical.href);

      const route = normalizeRoute(canonical.pathname);
      const routeKey = `${canonical.origin}\0${route}`;
      const routeAlias = seenRouteUrls.get(routeKey);
      if (routeAlias && routeAlias !== canonical.href) {
        findings.push(finding(
          'sitemap-url-alias',
          'error',
          `Sitemap contains non-canonical aliases for one route: ${routeAlias} and ${canonical.href}`,
          canonical.pathname,
          servedPath,
        ));
        continue;
      }
      seenRouteUrls.set(routeKey, canonical.href);
      const page = staticPages.get(route);
      if (page?.canonical && page.canonical !== canonical.href) {
        findings.push(finding(
          'sitemap-canonical-mismatch',
          'error',
          `Sitemap URL ${canonical.href} disagrees with the page canonical ${page.canonical}.`,
          canonical.pathname,
          servedPath,
        ));
      }
      if (routePaths.size > 0 && !routePaths.has(route) && !runtimeUrls.has(canonical.href)) {
        findings.push(finding(
          'sitemap-route-missing',
          'error',
          `Sitemap URL does not match a resolved or rendered page: ${canonical.href}`,
          canonical.pathname,
          servedPath,
        ));
      }

      /** @type {{ language: string; url: string }[]} */
      const alternates = [];
      for (const alternate of entry.alternates) {
        const url = safeHttpUrl(alternate.url);
        if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash) {
          findings.push(finding('sitemap-hreflang-url-invalid', 'error', `Invalid hreflang URL: ${redactUrl(alternate.url)}`, canonical.pathname, servedPath));
          continue;
        }
        if (documentOrigin && url.origin === documentOrigin) {
          const targetRoute = normalizeRoute(url.pathname);
          const target = staticPages.get(targetRoute);
          if (target?.canonical && target.canonical !== url.href) {
            findings.push(finding('sitemap-hreflang-canonical-mismatch', 'error', `Hreflang target is not canonical: ${url.href}`, canonical.pathname, servedPath));
            continue;
          }
          if (routePaths.size > 0 && !routePaths.has(targetRoute) && !runtimeUrls.has(url.href)) {
            findings.push(finding('sitemap-hreflang-target-missing', 'error', `Hreflang target is not a known page: ${url.href}`, canonical.pathname, servedPath));
            continue;
          }
        }
        alternates.push({ language: alternate.language, url: url.href });
      }
      entries.push({ loc: canonical.href, alternates, sourcePath: servedPath });
    }
  }

  function finish() {
    const urls = entries.map((entry) => entry.loc).sort(codeUnitCompare);
    return {
      valid: findings.every((entry) => entry.severity !== 'error'),
      findings,
      documentsChecked: seenDocuments.size,
      urls,
    };
  }
}

/** @param {string} root @param {string | null} origin @param {string} base */
function discoverStaticPages(root, origin, base) {
  /** @type {Map<string, { canonical?: string; route: string }>} */
  const pages = new Map();
  /** @param {string} directory @param {string[]} parts */
  const visit = (directory, parts) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) visit(path, [...parts, entry.name]);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const pathParts = [...parts, entry.name];
      const filePath = pathParts.join('/');
      const appRoute = filePath === 'index.html'
        ? '/'
        : filePath.endsWith('/index.html')
          ? `/${filePath.slice(0, -'index.html'.length)}`
          : `/${filePath.slice(0, -'.html'.length)}`;
      const route = normalizeRoute(withBase(appRoute, base));
      let canonical;
      try {
        const documentUrl = origin ? new URL(route, `${origin}/`) : undefined;
        canonical = authoredCanonical(readFileSync(path, 'utf8'), documentUrl).canonical;
      } catch {
        // An unreadable page cannot grant a sitemap route, but the concrete
        // route remains known from the build output filename.
      }
      pages.set(route, { route, ...(canonical ? { canonical } : {}) });
    }
  };
  visit(root, []);
  return pages;
}

/** @param {string} value @param {string | null} origin @param {string} base */
function localReference(value, origin, base) {
  const url = safeHttpUrl(value);
  if (!url || url.username || url.password || url.search || url.hash) return null;
  if (origin && url.origin !== origin) return null;
  if (!pathWithinBase(url.pathname, base)) return null;
  if (/%(?:2e|2f|5c)/i.test(url.pathname)) return null;
  return url;
}

/** @param {string} root @param {string} pathname @param {string} base */
function resolveRootPath(root, pathname, base) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || /[?#]/.test(pathname)) return null;
  if (/%(?:2e|2f|5c)/i.test(pathname)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = stripBase(decoded, base);
  if (relativePath === null || !relativePath) return null;
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(root, candidate);
  return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
    ? null
    : candidate;
}

/** @param {string} path */
function regularNonSymlink(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** @param {string} root @param {string} path */
function confinedRegularFile(root, path) {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return false;
  let current = root;
  for (const part of fromRoot.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return regularNonSymlink(path);
}

/** @param {unknown} value */
function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function normalizeOrigin(value) {
  const url = safeHttpUrl(value);
  return url && !url.username && !url.password ? url.origin : null;
}

/** @param {string} base */
function normalizeBase(base) {
  if (!base || base === '/') return '';
  return `/${base.replace(/^\/+|\/+$/g, '')}`;
}

/** @param {string} pathname @param {string} base */
function pathWithinBase(pathname, base) {
  return !base || pathname === base || pathname.startsWith(`${base}/`);
}

/** @param {string} pathname @param {string} base */
function stripBase(pathname, base) {
  if (!base) return pathname.replace(/^\/+/, '');
  if (pathname === base) return '';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : null;
}

/** @param {string} pathname @param {string} base */
function withBase(pathname, base) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (!base) return normalized;
  return normalized === '/' ? `${base}/` : `${base}${normalized}`;
}

/** @param {string} route */
function normalizeRoute(route) {
  let value;
  try {
    value = decodeURI(route);
  } catch {
    value = route;
  }
  value = value.startsWith('/') ? value : `/${value}`;
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

/** @param {string} pathname */
function normalizeServedPath(pathname) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

/** @param {string} value */
function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '<invalid URL>';
  }
}

/** @param {string} code @param {'warning'|'error'} severity @param {string} message @param {string} [pathname] @param {string} [sourcePath] */
function finding(code, severity, message, pathname, sourcePath) {
  return { code, severity, message, ...(pathname ? { pathname } : {}), ...(sourcePath ? { sourcePath } : {}) };
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} left @param {string} right */
function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

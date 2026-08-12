// @ts-check
import { parseDocument } from './html-document.js';

/**
 * @typedef {{ locale: string; path: string; language: string; aliases: string[]; origin?: string }} NormalizedLocale
 * @typedef {{ locales: NormalizedLocale[]; defaultLocale?: string; defaultLanguage?: string; primaryOrigin?: string; origins: string[]; prefixDefaultLocale: boolean; manual: boolean }} LocaleSnapshot
 */

/**
 * Convert Astro's i18n configuration into serializable route and language
 * facts shared by static collection and middleware.
 * @param {any} i18n
 * @param {string} [siteUrl]
 * @returns {LocaleSnapshot}
 */
export function createLocaleSnapshot(i18n, siteUrl = '') {
  const primaryOrigin = normalizeOrigin(siteUrl) ?? undefined;
  if (!i18n || !Array.isArray(i18n.locales)) {
    return {
      locales: [],
      ...(primaryOrigin ? { primaryOrigin } : {}),
      origins: primaryOrigin ? [primaryOrigin] : [],
      prefixDefaultLocale: false,
      manual: false,
    };
  }
  const domains = i18n.domains && typeof i18n.domains === 'object' ? i18n.domains : {};
  /** @type {NormalizedLocale[]} */
  const locales = [];
  for (const entry of i18n.locales) {
    const path = typeof entry === 'string' ? entry : entry?.path;
    const codes = typeof entry === 'string' ? [entry] : Array.isArray(entry?.codes) ? entry.codes : [];
    if (typeof path !== 'string' || !path || codes.length === 0) continue;
    const language = canonicalLanguage(codes[0]);
    if (!language) continue;
    const aliases = [...new Set(codes.flatMap((/** @type {unknown} */ code) => {
      const normalized = canonicalLanguage(code);
      return normalized ? [normalized] : [];
    }))];
    const domainValue = domains[path] ?? domains[codes[0]];
    const origin = normalizeOrigin(domainValue);
    locales.push({ locale: path, path, language, aliases, ...(origin ? { origin } : {}) });
  }
  const defaultEntry = localeForAlias(i18n.defaultLocale, locales);
  const routing = i18n.routing;
  return {
    locales,
    ...(defaultEntry ? { defaultLocale: defaultEntry.locale, defaultLanguage: defaultEntry.language } : {}),
    ...(primaryOrigin ? { primaryOrigin } : {}),
    origins: [...new Set([
      ...(primaryOrigin ? [primaryOrigin] : []),
      ...locales.flatMap((locale) => locale.origin ? [locale.origin] : []),
    ])],
    prefixDefaultLocale: routing && routing !== 'manual' ? routing.prefixDefaultLocale === true : false,
    manual: routing === 'manual',
  };
}

/** @param {unknown} value */
export function canonicalLanguage(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().replace(/_/g, '-');
  if (candidate.toLowerCase() === 'x-default') return 'x-default';
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Infer the Astro route locale without treating a default-locale unprefixed
 * route as unresolved. Domain mappings take precedence over path prefixes.
 * @param {string} pathname
 * @param {string | undefined} origin
 * @param {LocaleSnapshot} snapshot
 */
export function astroRouteLocale(pathname, origin, snapshot) {
  const normalizedOrigin = normalizeOrigin(origin ?? '');
  if (normalizedOrigin) {
    const domainLocales = snapshot.locales.filter((locale) => locale.origin === normalizedOrigin);
    if (domainLocales.length === 1) return domainLocales[0];
  }
  const first = pathname.split('/').filter(Boolean)[0];
  if (first) {
    const byPath = snapshot.locales.find((locale) => locale.path === decodeSegment(first));
    if (byPath) return byPath;
  }
  if (!snapshot.manual && !snapshot.prefixDefaultLocale && snapshot.defaultLocale) {
    return snapshot.locales.find((locale) => locale.locale === snapshot.defaultLocale) ?? null;
  }
  return null;
}

/**
 * Resolve a final page language and locale after semantic head enrichment.
 * @param {any} page
 * @param {LocaleSnapshot} snapshot
 * @param {{ unresolvedLanguage: 'default'|'error'|'exclude'; siteDefaultLocale?: string }} options
 */
export function resolvePageLocale(page, snapshot, options) {
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];
  const sources = page.languageSources ?? {};
  const semanticLanguage = page.language !== undefined && page.language !== sources.initial
    ? page.language
    : undefined;
  const present = semanticLanguage ?? sources.declared ?? sources.rendered;
  let language = present === undefined ? null : canonicalLanguage(present);
  if (present !== undefined && !language) {
    diagnostics.push(localeDiagnostic('page-language-invalid', 'error', 'The page declared an invalid language and was excluded from corpora.', page.pathname));
    return { page, excluded: true, diagnostics };
  }
  let locale = language ? localeForAlias(language, snapshot.locales) : null;
  if (!language) {
    const route = astroRouteLocale(page.pathname, page.origin, snapshot);
    if (route) {
      locale = route;
      language = route.language;
    }
  }
  if (!language && snapshot.defaultLanguage) {
    locale = snapshot.locales.find((entry) => entry.locale === snapshot.defaultLocale) ?? null;
    language = snapshot.defaultLanguage;
  }
  const siteDefault = sources.siteDefault ?? options.siteDefaultLocale;
  if (!language && siteDefault) {
    language = canonicalLanguage(siteDefault);
    if (!language) {
      diagnostics.push(localeDiagnostic('site-default-locale-invalid', 'error', 'site.defaultLocale is not a valid language tag.', page.pathname));
      return { page, excluded: true, diagnostics };
    }
    locale = localeForAlias(language, snapshot.locales);
  }
  if (!language && snapshot.locales.length === 0 && !options.siteDefaultLocale) {
    return {
      page: {
        ...page,
        origin: normalizeOrigin(page.origin) ?? snapshot.primaryOrigin,
        locale: null,
      },
      excluded: false,
      diagnostics,
    };
  }
  if (!language) {
    if (options.unresolvedLanguage === 'exclude') {
      diagnostics.push(localeDiagnostic('page-language-unresolved', 'warning', 'The page has no resolvable language and was excluded from corpora.', page.pathname));
    } else {
      diagnostics.push(localeDiagnostic('page-language-unresolved', 'error', 'The page has no resolvable language and was excluded from corpora.', page.pathname));
    }
    return { page, excluded: true, diagnostics };
  }
  const resolvedLocale = locale?.locale ?? language;
  const resolvedOrigin = normalizeOrigin(page.origin) ?? locale?.origin ?? snapshot.primaryOrigin;
  return {
    page: {
      ...page,
      ...(resolvedOrigin ? { origin: resolvedOrigin } : {}),
      locale: resolvedLocale,
      language,
    },
    excluded: false,
    diagnostics,
  };
}

/**
 * Normalize alternates for a complete origin-scoped page collection and
 * validate local canonical/reciprocal relationships without network access.
 * @param {any[]} pages
 */
export function normalizePageAlternates(pages) {
  /** @type {import('../index.js').Diagnostic[]} */
  const diagnostics = [];
  const byCanonical = new Map(pages.flatMap((page) =>
    typeof page.canonicalUrl === 'string' ? [[page.canonicalUrl, page]] : []));
  const normalizedPages = pages.map((page) => {
    const byLanguage = new Map();
    const blockedStructured = new Set();
    const structuredLanguages = new Set();
    for (const alternate of Array.isArray(page.alternates) ? page.alternates : []) {
      const language = canonicalLanguage(alternate?.language ?? alternate?.lang);
      const url = publicHttpsUrl(alternate?.url ?? alternate?.href, page.canonicalUrl ?? page.url);
      if (!language || !url) {
        diagnostics.push(localeDiagnostic('hreflang-invalid', 'error', 'An invalid hreflang alternate was discarded.', page.pathname));
        continue;
      }
      if (byLanguage.has(language) && byLanguage.get(language) !== url) {
        diagnostics.push(localeDiagnostic('hreflang-duplicate-language', 'error', `Conflicting ${language} alternates were discarded.`, page.pathname));
        byLanguage.delete(language);
        blockedStructured.add(language);
        continue;
      }
      if (!blockedStructured.has(language)) {
        byLanguage.set(language, url);
        structuredLanguages.add(language);
      }
    }
    const blockedRendered = new Set();
    for (const alternate of extractRenderedAlternates(page.representations?.html, page.canonicalUrl ?? page.url)) {
      const language = canonicalLanguage(alternate.language);
      const url = publicHttpsUrl(alternate.url, page.canonicalUrl ?? page.url);
      if (!language || !url) {
        diagnostics.push(localeDiagnostic('hreflang-invalid', 'error', 'An invalid rendered hreflang alternate was discarded.', page.pathname));
        continue;
      }
      if (blockedStructured.has(language) || blockedRendered.has(language)) continue;
      if (byLanguage.has(language)) {
        if (byLanguage.get(language) !== url) {
          if (structuredLanguages.has(language)) {
            diagnostics.push(localeDiagnostic(
              'hreflang-structured-precedence',
              'error',
              `Rendered ${language} hreflang conflicted with the structured declaration and was discarded.`,
              page.pathname,
            ));
          } else {
            diagnostics.push(localeDiagnostic('hreflang-duplicate-language', 'error', `Conflicting rendered ${language} alternates were discarded.`, page.pathname));
            byLanguage.delete(language);
            blockedRendered.add(language);
          }
        }
        continue;
      }
      byLanguage.set(language, url);
    }
    return {
      ...page,
      alternates: [...byLanguage]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([language, url]) => ({ language, url })),
    };
  });
  for (const page of normalizedPages) {
    for (const alternate of page.alternates) {
      const target = byCanonical.get(alternate.url);
      if (!target) continue;
      if (urlOrigin(page.canonicalUrl) !== urlOrigin(alternate.url)) continue;
      if (target.canonicalUrl !== alternate.url) {
        diagnostics.push(localeDiagnostic('hreflang-canonical-conflict', 'error', 'A local hreflang target is not canonical.', page.pathname));
        continue;
      }
      const reciprocal = normalizedPages.find((/** @type {any} */ candidate) => candidate.canonicalUrl === alternate.url)
        ?.alternates.some((/** @type {any} */ candidate) => candidate.url === page.canonicalUrl);
      if (!reciprocal) {
        diagnostics.push(localeDiagnostic('hreflang-not-reciprocal', 'error', 'A local hreflang alternate is not reciprocal.', page.pathname));
      }
    }
  }
  return { pages: normalizedPages, diagnostics };
}

/** @param {unknown} value */
function urlOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** @param {unknown} html @param {string} base */
function extractRenderedAlternates(html, base) {
  if (typeof html !== 'string' || !html) return [];
  try {
    const document = parseDocument(html);
    return [...document.querySelectorAll('link[hreflang]')].flatMap((element) => {
      const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      return rel.includes('alternate')
        ? [{ language: element.getAttribute('hreflang'), url: element.getAttribute('href'), base }]
        : [];
    });
  } catch {
    return [];
  }
}

/** @param {unknown} value @param {string} base */
function publicHttpsUrl(value, base) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** @param {unknown} value @param {NormalizedLocale[]} locales */
function localeForAlias(value, locales) {
  const language = canonicalLanguage(value);
  if (!language) return null;
  return locales.find((locale) =>
    locale.locale === value || locale.path === value || locale.aliases.includes(language)) ?? null;
}

/** @param {string} value */
function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** @param {string} code @param {'warning'|'error'} severity @param {string} message @param {string} pathname */
function localeDiagnostic(code, severity, message, pathname) {
  return { version: /** @type {const} */ (1), code, severity, message, pathname };
}

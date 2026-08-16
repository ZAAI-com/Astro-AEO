// @ts-check
import { createId, validateGraph } from '../schema.js';
import { stableCanonical } from './canonical.js';
import { inspectRootPathname, normalizeCatalogPathname } from './match.js';

const RENDERING = new Set(['prerendered', 'on-demand']);
const SOURCE_KINDS = new Set(['markdown', 'mdx', 'astro', 'cms', 'rendered', 'custom']);
const SOURCE_STRATEGIES = new Set(['marker', 'markdown-route', 'rendered', 'catalog']);
const SEVERITIES = new Set(['info', 'warning', 'error']);
const DIRECTIVE_KEYS = ['index', 'includeInLlms', 'includeInLlmsFull', 'generateMarkdown'];

/** @param {unknown} value @returns {value is import('../page.js').PageDescriptor} */
export function isPageDescriptor(value) {
  if (!isRecord(value)) return false;
  const descriptor = /** @type {Record<string, any>} */ (value);
  if (!isPipelinePathname(descriptor.pathname)) return false;
  if (!optionalString(descriptor.routePattern) ||
      !optionalEnum(descriptor.rendering, RENDERING) ||
      !optionalString(descriptor.title) ||
      !optionalString(descriptor.description) ||
      !optionalString(descriptor.image) ||
      !optionalString(descriptor.language) ||
      !optionalString(descriptor.markdown) ||
      !optionalString(descriptor.sourcePath)) return false;
  if (descriptor.dates !== undefined && !isDescriptorDates(descriptor.dates)) return false;
  if (descriptor.lastModified !== undefined && !isIsoDateOrRfc3339(descriptor.lastModified)) return false;
  if (descriptor.authors !== undefined && !isEntityReferences(descriptor.authors)) return false;
  if (descriptor.entities !== undefined && !isSchemaEntities(descriptor.entities)) return false;
  if (descriptor.directives !== undefined && !isDirectives(descriptor.directives, false)) return false;
  if (descriptor.source !== undefined && !isPageSource(descriptor.source, false)) return false;
  return descriptor.extraction === undefined || isExtractionDiagnostics(descriptor.extraction);
}

/** @param {unknown} value @returns {value is import('../index.js').AeoPageRecord} */
export function isPageRecord(value) {
  if (!isRecord(value)) return false;
  const page = /** @type {Record<string, any>} */ (value);
  if (!safeString(page.id, true) || !isPipelinePathname(page.pathname)) return false;
  const validPageUrl = isAbsolutePageUrl(page.url) ||
    (page.canonicalUrl === undefined && isRootRelativePageUrl(page.url));
  if (!validPageUrl || !safeString(page.mdHref, true) ||
      !inspectRootPathname(page.mdHref)?.decoded.endsWith('.md') || typeof page.markdown !== 'string') return false;
  if (!optionalString(page.routePattern) || !RENDERING.has(page.rendering)) return false;
  if (page.canonicalUrl !== undefined && !stableCanonical(page.canonicalUrl)) return false;
  if (page.markdownUrl !== undefined && !stableCanonical(page.markdownUrl)) return false;
  if (!optionalString(page.language) || !isPageMetadata(page.metadata)) return false;
  if ((page.canonicalUrl === undefined) !== (page.metadata.canonicalSource === undefined)) return false;
  if (!isRepresentations(page.representations)) return false;
  if (page.dates !== undefined && !isRecordDates(page.dates)) return false;
  if (!isEntityReferences(page.authors, page.canonicalUrl)) return false;
  if (!isSchemaEntities(page.entities, page.canonicalUrl)) return false;
  if (!isDirectives(page.directives, true)) return false;
  if (!Array.isArray(page.aeoTokens) || page.aeoTokens.some((token) => !safeString(token, false))) {
    return false;
  }
  if (page.source !== undefined && !isPageSource(page.source, true)) return false;
  if (page.extraction !== undefined && !isExtractionDiagnostics(page.extraction)) return false;
  if (!Array.isArray(page.diagnostics) || page.diagnostics.some((item) => !isDiagnostic(item))) {
    return false;
  }
  if (page.lastModified !== undefined && !isRfc3339(page.lastModified)) return false;
  return page.title === page.metadata.title &&
    page.description === (page.metadata.description ?? '') &&
    page.markdown === (page.representations.markdown ?? '');
}

/** @param {unknown} value @returns {value is import('../index.js').AeoPageRecord['metadata']} */
export function isPageMetadata(value) {
  if (!isRecord(value)) return false;
  const metadata = /** @type {Record<string, any>} */ (value);
  return typeof metadata.title === 'string' &&
    optionalString(metadata.description) &&
    optionalString(metadata.image) &&
    optionalEnum(metadata.canonicalSource, new Set(['authored', 'inferred']));
}

/** @param {unknown} value */
export function isExtractionEnvelope(value) {
  if (!isRecord(value)) return false;
  const candidate = /** @type {Record<string, any>} */ (value);
  return isRepresentations(candidate.representations) &&
    (candidate.extraction === null || candidate.extraction === undefined ||
      isExtractionDiagnostics(candidate.extraction)) &&
    (candidate.source === undefined || isPageSource(candidate.source, true));
}

/**
 * @param {unknown} value
 * @param {{ id: string; pathname: string; site?: {siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore'} }} [expected]
 */
export function isGraphEnvelope(value, expected) {
  if (!isRecord(value)) return false;
  const candidate = /** @type {Record<string, any>} */ (value);
  if (typeof candidate.html !== 'string' || !isPageRecord(candidate.page) ||
      !isSemanticSite(candidate.site) || typeof candidate.explicit !== 'boolean') return false;
  if (expected &&
      (candidate.page.id !== expected.id || candidate.page.pathname !== expected.pathname)) return false;
  if (expected?.site && (
    candidate.site.siteUrl !== expected.site.siteUrl ||
    candidate.site.base !== expected.site.base ||
    candidate.site.trailingSlash !== expected.site.trailingSlash
  )) return false;
  if (candidate.graph !== null && !isAeoGraph(candidate.graph, candidate.page.canonicalUrl)) return false;
  return candidate.normalizedGraph === undefined || candidate.normalizedGraph === null ||
    isAeoGraph(candidate.normalizedGraph, candidate.page.canonicalUrl);
}

/** @param {unknown} value */
function isRepresentations(value) {
  if (!isRecord(value)) return false;
  const representations = /** @type {Record<string, any>} */ (value);
  return optionalString(representations.html) &&
    optionalString(representations.markdown) &&
    optionalString(representations.plainText);
}

/** @param {unknown} value */
function isExtractionDiagnostics(value) {
  if (!isRecord(value)) return false;
  const extraction = /** @type {Record<string, any>} */ (value);
  return safeString(extraction.strategy, true) &&
    nonNegativeInteger(extraction.selectedNodes) &&
    nonNegativeInteger(extraction.removedNodes) &&
    nonNegativeInteger(extraction.inputCharacters) &&
    nonNegativeInteger(extraction.outputCharacters) &&
    optionalString(extraction.fallbackReason);
}

/** @param {unknown} value @param {boolean} allowStrategy */
function isPageSource(value, allowStrategy) {
  if (!isRecord(value)) return false;
  const source = /** @type {Record<string, any>} */ (value);
  return SOURCE_KINDS.has(source.kind) &&
    (!allowStrategy || optionalEnum(source.strategy, SOURCE_STRATEGIES)) &&
    (allowStrategy || source.strategy === undefined) &&
    optionalString(source.path) && optionalString(source.body) && optionalString(source.hash);
}

/** @param {unknown} value */
function isDescriptorDates(value) {
  if (!isRecord(value)) return false;
  const dates = /** @type {Record<string, any>} */ (value);
  return (dates.published === undefined || isIsoDateOrRfc3339(dates.published)) &&
    (dates.modified === undefined || isIsoDateOrRfc3339(dates.modified));
}

/** @param {unknown} value */
function isRecordDates(value) {
  if (!isRecord(value)) return false;
  const dates = /** @type {Record<string, any>} */ (value);
  return (dates.published === undefined || isRfc3339(dates.published)) &&
    (dates.modified === undefined || isRfc3339(dates.modified));
}

/** @param {unknown} value @param {boolean} required */
function isDirectives(value, required) {
  if (!isRecord(value)) return false;
  const directives = /** @type {Record<string, any>} */ (value);
  return DIRECTIVE_KEYS.every((key) => required
    ? typeof directives[key] === 'boolean'
    : directives[key] === undefined || typeof directives[key] === 'boolean');
}

/** @param {unknown} value @param {string | undefined} [documentCanonical] */
function isEntityReferences(value, documentCanonical) {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item) || Object.keys(item).length !== 1 || typeof item['@id'] !== 'string') return false;
    try {
      createId(item['@id'], documentCanonical);
      return true;
    } catch {
      return false;
    }
  });
}

/** @param {unknown} value @param {unknown} [documentCanonical] */
function isSchemaEntities(value, documentCanonical) {
  if (!Array.isArray(value)) return false;
  const result = validateGraph(/** @type {any} */ (value), {
    ...(typeof documentCanonical === 'string' ? { documentCanonical } : {}),
    strictReferences: false,
  });
  return result.valid;
}

/** @param {unknown} value @param {unknown} [documentCanonical] */
function isAeoGraph(value, documentCanonical) {
  if (!isRecord(value) || value.version !== 1 ||
      !Array.isArray(value.entries) || !Array.isArray(value.conflicts)) return false;
  const result = validateGraph(/** @type {any} */ (value), {
    ...(typeof documentCanonical === 'string' ? { documentCanonical } : {}),
    strictReferences: false,
  });
  return result.valid;
}

/** @param {unknown} value */
function isSemanticSite(value) {
  if (!isRecord(value)) return false;
  const site = /** @type {Record<string, any>} */ (value);
  return typeof site.siteUrl === 'string' && typeof site.base === 'string' &&
    ['always', 'never', 'ignore'].includes(site.trailingSlash);
}

/** @param {unknown} value */
function isDiagnostic(value) {
  if (!isRecord(value)) return false;
  const diagnostic = /** @type {Record<string, any>} */ (value);
  return diagnostic.version === 1 && safeString(diagnostic.code, true) &&
    SEVERITIES.has(diagnostic.severity) && safeString(diagnostic.message, true) &&
    diagnostic.message.length <= 1000 && optionalString(diagnostic.pathname) &&
    optionalString(diagnostic.sourcePath);
}

/** Accept RFC 3339 date-times with real calendar values. @param {unknown} value */
function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  return Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59 &&
    (offsetHourText === undefined ||
      (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
}

/**
 * Catalog descriptors document ISO dates and normalize them before producing
 * page records. Accept the full-date form at that boundary, while page records
 * and JSON-LD lifecycle values continue to require an RFC 3339 timestamp.
 * @param {unknown} value
 */
function isIsoDateOrRfc3339(value) {
  return isIsoFullDate(value) || isRfc3339(value);
}

/** @param {unknown} value */
function isIsoFullDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/**
 * Catalog inputs retain canonical URL spelling, while Astro request records are
 * already decoded and may contain Unicode or a literal percent character.
 * @param {unknown} value
 */
function isPipelinePathname(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  if (value !== '/' && value.endsWith('/')) return false;
  if (value.startsWith('//') || value.includes('//') || /[\\?#\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  if (normalizeCatalogPathname(value) === value) return true;
  if (!value.includes('%')) return true;
  try {
    decodeURIComponent(value);
    return false;
  } catch {
    return true;
  }
}

/** @param {unknown} value */
function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** @param {unknown} value */
function optionalString(value) {
  return value === undefined || typeof value === 'string';
}

/** @param {unknown} value @param {Set<string>} values */
function optionalEnum(value, values) {
  return value === undefined || values.has(/** @type {string} */ (value));
}

/** @param {unknown} value @param {boolean} nonEmpty */
function safeString(value, nonEmpty) {
  return typeof value === 'string' && (!nonEmpty || value.trim() !== '') && !hasControl(value);
}

/** @param {unknown} value */
function isAbsolutePageUrl(value) {
  if (typeof value !== 'string' || hasControl(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function isRootRelativePageUrl(value) {
  return typeof value === 'string' && inspectRootPathname(value) !== null;
}

/** @param {string} value */
function hasControl(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

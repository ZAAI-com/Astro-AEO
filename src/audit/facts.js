// @ts-check
import { createHash } from 'node:crypto';
import { htmlRegions } from './regions.js';
import { parseDocument } from '../core/html-document.js';
import { extractEditorialFacts } from './editorial.js';

/**
 * What the audit rules need to know about one page. The offline audit, the live
 * audit and the `recommended` build gate each produce this shape from their own
 * input, so one rule set serves all three.
 *
 * @typedef {object} PageFacts
 * @property {string} url                 Page identity: a pathname offline, an absolute URL live.
 * @property {boolean} renderedHtml       Whether metadata was observed in rendered HTML.
 * @property {string} [file]              Audited file, relative to the audited root.
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [canonical]
 * @property {string} [documentUrl]       Absolute base for same-page structured-data references.
 * @property {string} [version]
 * @property {string} [locale]
 * @property {import('../index.js').VersionPageAlternate[]} [versionAlternates]
 * @property {string} [language]
 * @property {boolean} noindex
 * @property {{ language: string; href: string }[]} alternates
 * @property {string[]} markdownAlternates
 * @property {string[]} links             Raw `href` values of every anchor.
 * @property {Set<string>} anchors        Every `id` and named anchor on the page.
 * @property {string[]} jsonLd            Raw JSON-LD script bodies.
 * @property {string} [markdownFile] Audited companion path, never inferred author source.
 * @property {ReturnType<typeof htmlRegions>} [regions]
 * @property {string} [contentHash] Normalized visible main-content hash, no source body.
 * @property {number} [contentWords]
 * @property {string} [markdown]          Companion Markdown, when one exists.
 * @property {import('./editorial.js').EditorialFacts} [editorial]
 */

/**
 * @param {string} html
 * @param {{ url: string; file?: string; markdownFile?: string; markdown?: string; documentUrl?: string; heuristics?: boolean }} identity
 * @returns {PageFacts}
 */
export function extractPageFacts(html, identity) {
  const document = parseDocument(html);
  const text = (/** @type {string} */ selector, /** @type {string} */ attribute) => {
    const value = document.querySelector(selector)?.getAttribute(attribute)?.trim();
    return value ? value : undefined;
  };
  const title = document.querySelector('title')?.textContent?.trim();
  const robots = text('meta[name="robots" i]', 'content') ?? '';
  /** @type {PageFacts['alternates']} */
  const alternates = [];
  /** @type {string[]} */
  const markdownAlternates = [];
  for (const link of document.querySelectorAll('link[rel~="alternate" i]')) {
    const href = link.getAttribute('href')?.trim();
    if (!href) continue;
    const language = link.getAttribute('hreflang')?.trim();
    if (language) alternates.push({ language, href });
    else if (link.getAttribute('type')?.trim().toLowerCase() === 'text/markdown') markdownAlternates.push(href);
  }
  /** @type {string[]} */
  const links = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')?.trim();
    if (href) links.push(href);
  }
  const anchors = new Set();
  for (const element of document.querySelectorAll('[id], a[name]')) {
    const id = element.getAttribute('id') ?? element.getAttribute('name');
    if (id) anchors.add(id);
  }
  /** @type {string[]} */
  const jsonLd = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json" i]')) {
    jsonLd.push(script.textContent ?? '');
  }
  const language = document.documentElement?.getAttribute('lang')?.trim();
  const canonical = text('link[rel="canonical" i]', 'href');
  const documentUrl = documentUrlFor(identity.documentUrl ?? identity.url, canonical);
  return {
    url: identity.url,
    renderedHtml: true,
    regions: htmlRegions(html),
    ...visibleContentFacts(document),
    ...(identity.file ? { file: identity.file } : {}),
    ...(identity.markdownFile ? {markdownFile:identity.markdownFile} : {}),
    ...(title ? { title } : {}),
    ...(text('meta[name="description" i]', 'content') ? { description: text('meta[name="description" i]', 'content') } : {}),
    ...(canonical ? { canonical } : {}),
    ...(documentUrl ? { documentUrl } : {}),
    ...(language ? { language } : {}),
    noindex: /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(robots),
    alternates,
    markdownAlternates,
    links,
    anchors,
    jsonLd,
    ...(identity.heuristics ? { editorial: extractEditorialFacts(html, document, documentUrl) } : {}),
    ...(identity.markdown === undefined ? {} : { markdown: identity.markdown }),
  };
}

/** @param {string} pageUrl @param {string} [canonical] @param {string} [siteUrl] */
export function documentUrlFor(pageUrl, canonical, siteUrl) {
  const http = (/** @type {URL | undefined} */ url) => url && /^https?:$/.test(url.protocol) ? url.href : undefined;
  const parse = (/** @type {string} */ value, /** @type {string | URL | undefined} */ base) => {
    try { return new URL(value, base); } catch { return undefined; }
  };
  const page = parse(pageUrl, siteUrl);
  // A non-HTTP or malformed canonical must not discard a valid page URL.
  if (canonical) return http(parse(canonical, page)) ?? http(page);
  return http(page);
}

/**
 * Facts for a page the build already modeled. There is no rendered link or
 * anchor inventory at that point, so link rules stay silent for these pages.
 *
 * @param {import('../core/page-model.js').AeoPageRecord} page
 * @returns {PageFacts}
 */
export function factsFromPageRecord(page) {
  return {
    url: page.pathname,
    ...(page.representations?.html ? visibleContentFacts(parseDocument(page.representations.html)) : {}),
    renderedHtml: false,
    ...(page.title ? { title: page.title } : {}),
    ...(page.description ? { description: page.description } : {}),
    ...(page.canonicalUrl ? { canonical: page.canonicalUrl } : {}),
    ...(page.language ? { language: page.language } : {}),
    ...(page.version ? { version: page.version } : {}),
    ...(page.locale ? { locale: page.locale } : {}),
    ...(page.alternates?.some((alternate) => alternate.kind === 'version')
      ? { versionAlternates: /** @type {import('../index.js').VersionPageAlternate[]} */ (page.alternates.filter((alternate) => alternate.kind === 'version')) } : {}),
    noindex: page.directives?.index === false,
    alternates: (page.alternates ?? []).filter((alternate) => alternate.kind !== 'version').map((alternate) => ({ language: /** @type {import('../index.js').LanguagePageAlternate} */ (alternate).language, href: alternate.url })),
    markdownAlternates: [],
    links: [],
    anchors: new Set(),
    jsonLd: page.entities?.length ? [JSON.stringify({'@graph':page.entities})] : [],
    ...(page.directives?.generateMarkdown === false ? {} : { markdown: page.markdown ?? '' }),
  };
}

/** Hash only observed public main text, excluding common chrome and executable content.
 * @param {ReturnType<typeof parseDocument>} document */
function visibleContentFacts(document) {
  const root = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  if (!root) return {};
  for (let node = /** @type {Element|null} */ (root); node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden')?.toLowerCase() === 'true') return {};
  }
  const copy = /** @type {Element} */ (root.cloneNode(true));
  for (const element of copy.querySelectorAll('nav,header,footer,aside,script,style,template,noscript,[hidden],[aria-hidden="true" i]')) element.remove();
  for (const element of copy.querySelectorAll('div,section,article,h1,h2,h3,h4,h5,h6,p,li,table,tr,td,th,dd,dt,blockquote,pre,br')) {
    element.prepend(document.createTextNode(' ')); element.append(document.createTextNode(' '));
  }
  const text = (copy.textContent ?? '').normalize('NFC').replace(/\s+/g,' ').trim();
  return {contentHash:'sha256:' + createHash('sha256').update(text).digest('hex'),
    contentWords:text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length};
}

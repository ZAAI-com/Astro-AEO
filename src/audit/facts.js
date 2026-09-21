// @ts-check
import { parseDocument } from '../core/html-document.js';

/**
 * What the audit rules need to know about one page. The offline audit, the live
 * audit and the `recommended` build gate each produce this shape from their own
 * input, so one rule set serves all three.
 *
 * @typedef {object} PageFacts
 * @property {string} url                 Page identity: a pathname offline, an absolute URL live.
 * @property {string} [file]              Audited file, relative to the audited root.
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [canonical]
 * @property {string} [language]
 * @property {boolean} noindex
 * @property {{ language: string; href: string }[]} alternates
 * @property {string[]} markdownAlternates
 * @property {string[]} links             Raw `href` values of every anchor.
 * @property {Set<string>} anchors        Every `id` and named anchor on the page.
 * @property {string[]} jsonLd            Raw JSON-LD script bodies.
 * @property {string} [markdown]          Companion Markdown, when one exists.
 */

/**
 * @param {string} html
 * @param {{ url: string; file?: string; markdown?: string }} identity
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
  return {
    url: identity.url,
    ...(identity.file ? { file: identity.file } : {}),
    ...(title ? { title } : {}),
    ...(text('meta[name="description" i]', 'content') ? { description: text('meta[name="description" i]', 'content') } : {}),
    ...(text('link[rel="canonical" i]', 'href') ? { canonical: text('link[rel="canonical" i]', 'href') } : {}),
    ...(language ? { language } : {}),
    noindex: /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(robots),
    alternates,
    markdownAlternates,
    links,
    anchors,
    jsonLd,
    ...(identity.markdown === undefined ? {} : { markdown: identity.markdown }),
  };
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
    ...(page.title ? { title: page.title } : {}),
    ...(page.description ? { description: page.description } : {}),
    ...(page.canonicalUrl ? { canonical: page.canonicalUrl } : {}),
    ...(page.language ? { language: page.language } : {}),
    noindex: page.directives?.index === false,
    alternates: (page.alternates ?? []).map((alternate) => ({ language: alternate.language, href: alternate.url })),
    markdownAlternates: [],
    links: [],
    anchors: new Set(),
    jsonLd: [],
    ...(page.directives?.generateMarkdown === false ? {} : { markdown: page.markdown ?? '' }),
  };
}

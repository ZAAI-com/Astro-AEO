// @ts-check
import {
  hasHtmlHead,
  headTagSources,
  htmlElementRanges,
  htmlTagAttribute,
  insertIntoHead,
  replaceHeadTag,
} from './html-head-ranges.js';

/** @param {string} html */
export function hasMarkdownAlternateLink(html) {
  return alternateLinkTags(html).some(isMarkdownAlternate);
}

/** @param {string} html */
export function matchMarkdownAlternateLinks(html) {
  return alternateLinkTags(html).filter(isMarkdownAlternate);
}

/**
 * The detector is also a small public test/helper surface and historically
 * accepts a sequence of link elements without a surrounding document. Keep
 * that compatibility while the mutation path remains scoped to a real head.
 * @param {string} html
 */
function alternateLinkTags(html) {
  return hasHtmlHead(html)
    ? headTagSources(html, 'link')
    : htmlElementRanges(html, 'link').map((element) => element.source);
}

/**
 * @param {string} html
 * @param {string} href
 * @param {'auto'|'always'} mode
 */
export function withMarkdownAlternateLink(html, href, mode) {
  const safeHref = href
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const tag = `<link rel="alternate" type="text/markdown" href="${safeHref}">`;
  if (hasMarkdownAlternateLink(html)) {
    return mode === 'always'
      ? replaceHeadTag(html, 'link', isMarkdownAlternate, tag)
      : html;
  }
  return insertIntoHead(html, tag);
}

/** @param {string} tag */
function isMarkdownAlternate(tag) {
  const relations = (attribute(tag, 'rel') ?? '').split(/\s+/).map((value) => value.toLowerCase());
  return relations.includes('alternate') && attribute(tag, 'type')?.toLowerCase() === 'text/markdown';
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  return htmlTagAttribute(tag, name);
}

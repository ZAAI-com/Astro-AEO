// @ts-check
import { parseDocument } from '../core/html-document.js';
import { jsonLdEntities, schemaTypes, validSchemaDate } from '../core/schema-google.js';
import { createFinding } from './finding.js';

/** @typedef {{ kind: 'heading' | 'paragraph' | 'list' | 'table'; text: string; level?: number; ordered?: boolean; source?: boolean }} ContentBlock */
/** @typedef {{ blocks: ContentBlock[]; article: boolean; attributed: boolean; dates: string[] }} EditorialFacts */

/** @param {string} text */
function clean(text) { return text.replace(/`[^`]*`/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~]/g, '').trim(); }

/** @param {string} markdown @returns {ContentBlock[]} */
export function markdownBlocks(markdown) {
  /** @type {ContentBlock[]} */
  const blocks = [];
  const references = new Set([...markdown.matchAll(/^ {0,3}\[([^\]]+)\]:\s*\S+/gm)].map((match) => match[1].toLowerCase()));
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/);
  let fence = '';
  let fenceLength = 0;
  /** @type {string[]} */
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const raw = paragraph.join(' ');
    blocks.push({ kind: 'paragraph', text: clean(raw), source: /(?<!!)\[[^\]]+\]\(\s*[^\s)]+/.test(raw) ||
      /https?:\/\/\S+/.test(raw) || [...raw.matchAll(/(?<!!)\[([^\]]+)\](?:\[([^\]]*)\])?/g)].some((match) => references.has((match[2] || match[1]).toLowerCase())) });
    paragraph = [];
  };
  for (let position = 0; position < lines.length; position++) {
    const line = lines[position];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = '';
      continue;
    }
    if (marker) { flush(); fence = marker[1][0]; fenceLength = marker[1].length; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      while (position + 1 < lines.length && lines[position + 1].trim()) position++;
      continue;
    }
    if (!line.trim() || /^(?: {4}|\t)|^ {0,3}\[[^\]]+\]:/.test(line)) { flush(); continue; }
    if (/^ {0,3}<\/?(?:script|style|pre|blockquote|table|ol|ul)\b/i.test(line)) {
      flush();
      const tag = /^ {0,3}<([\w]+)/.exec(line)?.[1];
      if (tag === 'table') blocks.push({ kind: 'table', text: '' });
      if (tag === 'ol' || tag === 'ul') blocks.push({ kind: 'list', text: line, ordered: tag === 'ol' });
      if (tag && !line.includes(`</${tag}>`)) while (position + 1 < lines.length && !lines[position].includes(`</${tag}>`)) position++;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) { flush(); blocks.push({ kind: 'heading', text: clean(heading[2]), level: heading[1].length }); continue; }
    if (position + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[position + 1]) && line.trim()) {
      flush(); blocks.push({ kind: 'heading', text: clean(line), level: lines[++position].trim()[0] === '=' ? 1 : 2 }); continue;
    }
    if (position + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[position + 1])) {
      flush(); blocks.push({ kind: 'table', text: '' }); position++;
      while (position + 1 < lines.length && lines[position + 1].includes('|') && lines[position + 1].trim()) position++;
      continue;
    }
    const list = /^ {0,3}(?:(\d+)[.)]|[-+*])\s+/.exec(line);
    if (list) {
      flush(); blocks.push({ kind: 'list', text: clean(line.replace(list[0], '')), ordered: Boolean(list[1]) });
      while (position + 1 < lines.length && lines[position + 1].trim() && !/^ {0,3}(?:#{1,6}\s|(?:\d+[.)]|[-+*])\s)/.test(lines[position + 1])) position++;
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** @param {string} html @param {Document} [parsed] @returns {EditorialFacts | undefined} */
export function extractEditorialFacts(html, parsed) {
  const document = parsed ?? parseDocument(html);
  const region = document.querySelector('main') ?? document.querySelector('article');
  if (!region) return undefined;
  /** @type {ContentBlock[]} */
  const blocks = [];
  for (const element of region.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ol,ul,table')) {
    if (element.closest('pre,code,blockquote,nav,aside,footer,header,script,style,[hidden],[aria-hidden="true"]')) continue;
    const tag = element.localName;
    if (tag === 'p' && element.closest('li,table')) continue;
    const prose = /** @type {Element} */ (element.cloneNode(true));
    for (const code of prose.querySelectorAll('code')) code.remove();
    const text = prose.textContent?.trim() ?? '';
    if (/^h[1-6]$/.test(tag)) blocks.push({ kind: 'heading', text, level: Number(tag[1]) });
    else if (tag === 'p') blocks.push({ kind: 'paragraph', text, source: [...element.querySelectorAll('a[href]')].some((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      return Boolean(href.trim()) && !/^(?:javascript|data|mailto|tel):/i.test(href);
    }) });
    else if (tag === 'table') blocks.push({ kind: 'table', text });
    else blocks.push({ kind: 'list', text, ordered: tag === 'ol' });
  }
  const entities = [...document.querySelectorAll('script[type="application/ld+json" i]')].flatMap((script) => {
    try { return jsonLdEntities(JSON.parse(script.textContent ?? '')); } catch { return []; }
  });
  const articleEntities = entities.filter((entity) => schemaTypes(entity).some((type) => ['Article', 'BlogPosting', 'TechArticle', 'NewsArticle'].includes(type)));
  const byId = new Map(entities.filter((entity) => typeof entity['@id'] === 'string').map((entity) => [entity['@id'], entity]));
  const named = (/** @type {any} */ author) => {
    const resolved = author?.['@id'] ? byId.get(author['@id']) ?? author : author;
    return schemaTypes(resolved).some((type) => type === 'Person' || type === 'Organization') && typeof resolved?.name === 'string' && Boolean(resolved.name.trim());
  };
  const visible = document.querySelector('meta[name="author" i]')?.getAttribute('content')?.trim() ||
    [...region.querySelectorAll('[rel~="author" i],[itemprop="author" i]')].some((element) => Boolean(element.textContent?.trim()));
  const dates = articleEntities.flatMap((entity) => [entity.dateModified, entity.datePublished]).filter((date) => typeof date === 'string');
  for (const element of document.querySelectorAll('meta[property="article:published_time"],meta[property="article:modified_time"],time[itemprop="datePublished"],time[itemprop="dateModified"]')) {
    const date = element.getAttribute('content') ?? element.getAttribute('datetime');
    if (date) dates.push(date);
  }
  return { blocks, article: articleEntities.length > 0 || Boolean(document.querySelector('article,meta[property="og:type"][content="article"]')),
    attributed: Boolean(visible) || articleEntities.some((entity) => (Array.isArray(entity.author) ? entity.author : [entity.author]).some(named)), dates };
}

/**
 * @param {import('./facts.js').PageFacts} page
 * @param {Date} now
 * @returns {import('../index.js').Finding[]}
 */
export function auditEditorial(page, now) {
  if (page.noindex) return [];
  const facts = page.editorial;
  const blocks = page.markdown !== undefined ? markdownBlocks(page.markdown) : facts?.blocks;
  if (!blocks?.some((block) => block.text || block.kind === 'table')) return [];
  /** @type {import('../index.js').Finding[]} */
  const findings = [];
  const emit = (/** @type {string} */ ruleId, /** @type {string} */ message) => {
    if (findings.some((finding) => finding.ruleId === ruleId)) return;
    findings.push(createFinding({ ruleId, severity: 'info', message, url: page.url, file: page.file }));
  };
  const language = page.language?.toLowerCase().split('-')[0];
  const supported = language === 'en' || language === 'de';
  const question = (/** @type {string} */ text) => /[?？]\s*$/.test(text);
  const answered = (/** @type {number} */ start) => {
    const heading = blocks[start];
    for (let index = start + 1; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.kind === 'heading' && (block.level ?? 1) <= (heading.level ?? 1)) return false;
      if (block.kind !== 'heading' && (block.text || block.kind === 'table')) return true;
    }
    return false;
  };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind === 'paragraph') {
      if (block.text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length > 150) emit('editorial-long-paragraph', 'Split prose paragraphs longer than 150 words into focused, answer-first sections.');
      const prose = block.text.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\bv?\d+\.\d+(?:\.\d+)+(?:-[\w.]+)?\b/gi, '');
      if (!block.source && (/\b\d+(?:[.,]\d+)?\s*%/.test(prose) || (supported && /\b\d+(?:[.,]\d+)?\s*(?:percent\b|per cent\b|Prozent\b)|\b\d+(?:[.,]\d+)?\s+(?:out of|in|von)\s+\d+\b/i.test(prose)))) emit('editorial-unsourced-number', 'Add a source link in the paragraph for numerical claims. A link signals a citation, not verified evidence.');
    }
    if (block.kind === 'heading' && question(block.text) && !answered(index)) emit('editorial-unanswered-question', 'Follow question headings with answer text, a list, or a table.');
  }
  if (facts?.article) {
    if (!facts.attributed) emit('editorial-missing-attribution', 'Name the article author in structured data or visible author metadata.');
    const dates = facts.dates.filter(validSchemaDate).map((date) => Date.parse(date));
    if (dates.length && Math.floor(now.getTime() / 86400000) - Math.floor(Math.max(...dates) / 86400000) > 365) emit('editorial-review-reminder', 'Review this article: its latest publication or modification date is over 365 days old. Age alone does not mean evergreen content is outdated.');
  }
  if (supported) {
    const title = blocks.find((block) => block.kind === 'heading' && block.level === 1)?.text ?? page.title ?? '';
    if (/^(?:how\s+to\b|wie\b|anleitung\b|schritt.für.schritt\b)/i.test(title) && !blocks.some((block) => (block.kind === 'list' && block.ordered) || (block.kind === 'heading' && /^(?:\d+[.)]\s|(?:step|schritt)\s+\d+\b)/i.test(block.text)))) emit('editorial-howto-structure', 'For an explicit how-to title, provide an ordered list or numbered step headings.');
    if (/\b(?:versus|vs\.?|comparison|compare|vergleich|vergleichen)\b/i.test(title) && !blocks.some((block) => block.kind === 'table')) emit('editorial-comparison-structure', 'Use an accessible table for an explicit comparison where tabular comparison is appropriate.');
    if (/\bFAQ\b|frequently asked questions|häufig(?:e| gestellte) fragen/i.test(title) && !blocks.some((block, index) => block.kind === 'heading' && question(block.text) && answered(index))) emit('editorial-faq-structure', 'Organize an explicit FAQ into question headings followed by answers.');
  }
  return findings;
}

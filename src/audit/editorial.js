// @ts-check
import { parseDocument } from '../core/html-document.js';
import { jsonLdEntities, schemaTypes, validSchemaDate, schemaTimestamp } from '../core/schema-google.js';
import { createFinding } from './finding.js';

/** @typedef {{ kind: 'heading' | 'paragraph' | 'list' | 'table'; text: string; level?: number; ordered?: boolean; source?: boolean }} ContentBlock */
/** @typedef {{ blocks: ContentBlock[]; article: boolean; attributed: boolean; dates: string[] }} EditorialFacts */

const EXCLUDED_CONTENT = 'pre,code,blockquote,nav,aside,footer,header,script,style,noscript,iframe,template,[hidden],[aria-hidden="true" i]';
const HIDDEN_CONTENT = 'script,style,noscript,iframe,template,[hidden],[aria-hidden="true" i]';

/** @param {string} label */
function referenceLabel(label) { return label.trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Share excluded HTML regions between the prose and reference scanners.
 * Fences and indented code are opaque, so example markup cannot hide later prose.
 * @param {string[]} lines
 */
function visibleMarkdownLines(lines) {
  const excluded = new Set(['nav', 'aside', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'template']);
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  /** @type {string[]} */
  const hidden = [];
  let comment = false;
  let fence = '';
  let fenceLength = 0;
  return lines.map((line) => {
    if (!hidden.length && !comment) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = '';
        return line;
      }
      if (marker) { fence = marker[1][0]; fenceLength = marker[1].length; return line; }
      if (/^(?: {4}|\t)/.test(line)) return line;
      line = withoutInlineCode(line);
    }
    let visible = '';
    let position = 0;
    for (const token of line.matchAll(/<!--|-->|<\/?[a-z][^>]*>/gi)) {
      if (!comment && !hidden.length) visible += line.slice(position, token.index);
      position = token.index + token[0].length;
      if (comment) { if (token[0] === '-->') comment = false; continue; }
      if (token[0] === '<!--') { comment = true; visible += ' '; continue; }
      const tag = /^<(\/?)([a-z][\w-]*)/i.exec(token[0]);
      if (!tag) { if (!hidden.length) visible += token[0]; continue; }
      const name = tag[2].toLowerCase();
      if (tag[1]) {
        const index = hidden.lastIndexOf(name);
        if (index >= 0) { hidden.length = index; if (!hidden.length) visible += ' '; }
        else if (!hidden.length) visible += token[0];
      } else {
        const hide = hidden.length > 0 || excluded.has(name) || /\shidden(?:\s|=|\/?>)|\saria-hidden\s*=\s*(?:"true"|'true'|true)(?=\s|\/?>)/i.test(token[0]);
        if (hide) {
          if (!voidTags.has(name) && !/\/>$/.test(token[0])) hidden.push(name);
          visible += ' ';
        } else visible += token[0];
      }
    }
    if (!comment && !hidden.length) visible += line.slice(position);
    return visible;
  });
}

/** @param {string} text */
function withoutInlineCode(text) {
  return text.replace(/<code\b[^>]*>[\s\S]*?<\/code\s*>/gi, '')
    .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
}

/** @param {string} text @param {Map<string, string>} references */
function clean(text, references) {
  return withoutInlineCode(text)
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (match, label, reference) => references.has(referenceLabel(reference || label)) ? label : match)
    .replace(/<\/?[a-z][^>]*>/gi, '').replace(/[*_~]/g, '').trim();
}

/** @param {string} destination */
function citationUrl(destination) {
  const href = destination.trim();
  return Boolean(href) && !/^(?:javascript|data|mailto|tel):/i.test(href);
}

/** @param {string} text @param {Map<string, string>} references */
function markdownCitation(text, references) {
  let source = false;
  const prose = withoutInlineCode(text)
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/g, (_match, angle, plain) => {
      source ||= citationUrl(angle ?? plain);
      return '';
    })
    .replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (match, label, reference) => {
      const destination = references.get(referenceLabel(reference || label));
      if (destination === undefined) return match;
      source ||= citationUrl(destination);
      return '';
    })
    .replace(/<([a-z][a-z\d+.-]*:[^<>\s]*)>/gi, (_match, destination) => {
      source ||= citationUrl(destination);
      return '';
    });
  return source || [...prose.matchAll(/https?:\/\/[^\s<>]+/gi)].some((match) => citationUrl(match[0]));
}

/** @param {string[]} lines @returns {Map<string, string>} */
function markdownReferences(lines) {
  const references = new Map();
  let fence = '';
  let fenceLength = 0;
  let htmlBlock = '';
  for (const line of lines) {
    if (htmlBlock) {
      if (new RegExp(`</${htmlBlock}\\s*>`, 'i').test(line)) htmlBlock = '';
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = '';
      continue;
    }
    if (marker) { fence = marker[1][0]; fenceLength = marker[1].length; continue; }
    const tag = /^ {0,3}<(script|style|pre|blockquote|table|ol|ul)\b/i.exec(line)?.[1].toLowerCase();
    if (tag) {
      if (!new RegExp(`</${tag}\\s*>`, 'i').test(line)) htmlBlock = tag;
      continue;
    }
    const reference = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    if (reference) references.set(referenceLabel(reference[1]), reference[2] ?? reference[3]);
  }
  return references;
}

/** @param {string} markdown @returns {ContentBlock[]} */
export function markdownBlocks(markdown) {
  /** @type {ContentBlock[]} */
  const blocks = [];
  const lines = visibleMarkdownLines(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/));
  const references = markdownReferences(lines);
  let fence = '';
  let fenceLength = 0;
  /** @type {string[]} */
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const raw = paragraph.join(' ');
    blocks.push({ kind: 'paragraph', text: clean(raw, references), source: markdownCitation(raw, references) });
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
      while (position + 1 < lines.length && lines[position + 1].trim() && !/^ {0,3}(?:#{1,6}\s|`{3,}|~{3,}|(?:\d+[.)]|[-+*])\s|<|(?:[-*_]\s*){3,}$)/.test(lines[position + 1])) position++;
      continue;
    }
    if (!line.trim() || /^(?: {4}|\t)|^ {0,3}\[[^\]]+\]:/.test(line)) { flush(); continue; }
    if (/^ {0,3}<\/?(?:script|style|pre|blockquote|table|ol|ul)\b/i.test(line)) {
      flush();
      const tag = /^ {0,3}<([\w]+)/.exec(line)?.[1].toLowerCase();
      if (tag === 'table') blocks.push({ kind: 'table', text: '' });
      if (tag === 'ol' || tag === 'ul') blocks.push({ kind: 'list', text: line, ordered: tag === 'ol' });
      if (tag) {
        const close = new RegExp(`</${tag}\\s*>`, 'i');
        while (position + 1 < lines.length && !close.test(lines[position])) position++;
      }
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) { flush(); blocks.push({ kind: 'heading', text: clean(heading[2], references), level: heading[1].length }); continue; }
    if (position + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[position + 1]) && line.trim()) {
      flush(); blocks.push({ kind: 'heading', text: clean(line, references), level: lines[++position].trim()[0] === '=' ? 1 : 2 }); continue;
    }
    if (position + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[position + 1])) {
      flush(); blocks.push({ kind: 'table', text: '' }); position++;
      while (position + 1 < lines.length && lines[position + 1].includes('|') && lines[position + 1].trim()) position++;
      continue;
    }
    const list = /^ {0,3}(?:(\d+)[.)]|[-+*])\s+/.exec(line);
    if (list) {
      flush(); blocks.push({ kind: 'list', text: clean(line.replace(list[0], ''), references), ordered: Boolean(list[1]) });
      while (position + 1 < lines.length && lines[position + 1].trim() && !/^ {0,3}(?:#{1,6}\s|(?:\d+[.)]|[-+*])\s)/.test(lines[position + 1])) position++;
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** @param {string} html @param {Document} [parsed] @param {string} [documentUrl] @returns {EditorialFacts | undefined} */
export function extractEditorialFacts(html, parsed, documentUrl) {
  const document = parsed ?? parseDocument(html);
  const region = document.querySelector('main') ?? document.querySelector('article');
  if (!region) return undefined;
  /** @type {ContentBlock[]} */
  const blocks = [];
  for (const element of region.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ol,ul,table')) {
    if (element.closest(EXCLUDED_CONTENT)) continue;
    const tag = element.localName;
    if (tag === 'p' && element.closest('li,table')) continue;
    const prose = /** @type {Element} */ (element.cloneNode(true));
    for (const excluded of prose.querySelectorAll(EXCLUDED_CONTENT)) excluded.remove();
    const text = prose.textContent?.trim() ?? '';
    if (/^h[1-6]$/.test(tag)) blocks.push({ kind: 'heading', text, level: Number(tag[1]) });
    else if (tag === 'p') blocks.push({ kind: 'paragraph', text, source: [...prose.querySelectorAll('a[href]')].some((anchor) => Boolean(anchor.textContent?.trim()) && citationUrl(anchor.getAttribute('href') ?? '')) });
    else if (tag === 'table') blocks.push({ kind: 'table', text });
    else blocks.push({ kind: 'list', text, ordered: tag === 'ol' });
  }
  const entities = [...document.querySelectorAll('script[type="application/ld+json" i]')].flatMap((script) => {
    try { return jsonLdEntities(JSON.parse(script.textContent ?? '')); } catch { return []; }
  });
  const articleEntities = entities.filter((entity) => schemaTypes(entity).some((type) => ['Article', 'BlogPosting', 'TechArticle', 'NewsArticle'].includes(type)));
  const identity = (/** @type {string} */ id) => {
    try { return new URL(id, documentUrl).href; } catch { return id; }
  };
  /** @type {Map<string, Record<string, any>[]>} */
  const byId = new Map();
  for (const entity of entities) {
    if (typeof entity['@id'] !== 'string' || !Object.keys(entity).some((key) => key !== '@id' && key !== '@context')) continue;
    const id = identity(entity['@id']);
    const definitions = byId.get(id) ?? [];
    definitions.push(entity);
    byId.set(id, definitions);
  }
  const named = (/** @type {any} */ author) => {
    const definitions = typeof author?.['@id'] === 'string' ? [author, ...(byId.get(identity(author['@id'])) ?? [])] : [author];
    return definitions.some((entity) => schemaTypes(entity).some((type) => type === 'Person' || type === 'Organization')) &&
      definitions.some((entity) => typeof entity?.name === 'string' && Boolean(entity.name.trim()));
  };
  const visible = document.querySelector('meta[name="author" i]')?.getAttribute('content')?.trim() ||
    [...region.querySelectorAll('[rel~="author" i],[itemprop="author" i]')].some((element) => {
      if (element.closest(HIDDEN_CONTENT)) return false;
      const author = /** @type {Element} */ (element.cloneNode(true));
      for (const hidden of author.querySelectorAll(HIDDEN_CONTENT)) hidden.remove();
      return Boolean(author.textContent?.trim());
    });
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
    const dates = facts.dates.filter(validSchemaDate).map(schemaTimestamp);
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

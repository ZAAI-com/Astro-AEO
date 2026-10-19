// @ts-check
import { inspectRootPathname } from './match.js';
import { planMarkdownUnits } from './markdown-units.js';
import { canonicalJson, compareCodeUnits, sha256Digest } from './corpus-manifest.js';
import { normalizePublishedText } from './corpus-tokenizer.js';
import { pageMarkdown } from './render/page-markdown.js';

/** @typedef {import('../index.js').RagRecordV1} RagRecord */

/** Content records use published Markdown, never held source or rendered HTML.
 * Identity includes canonical URL, public route, locale and version, but not content.
 * A chunk identity uses its page and ordinal; content hashes disclose edits.
 * @param {any[]} pages
 * @param {{ maxTokens: number; tokenizer: RagRecord['tokenizer']; count: (text: string) => Promise<number> }} input
 */
export async function planRagRecords(pages, input) {
  if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1) throw new RangeError('RAG token budget must be positive.');
  /** @type {RagRecord[]} */
  const records = [];
  /** @type {Array<{code: string; severity: 'warning'; message: string; pathname: string}>} */
  const diagnostics = [];
  const identities = new Set();
  for (const page of [...pages].filter(isRagEligible)
    .sort((a, b) => compareCodeUnits(canonicalJson(identity(a)), canonicalJson(identity(b))))) {
    const key = canonicalJson(identity(page));
    if (identities.has(key)) throw new TypeError('Duplicate RAG page identity.');
    identities.add(key);
    const pageId = `page:${(await sha256Digest(key)).slice(7)}`;
    const text = normalizePublishedText(pageMarkdown(page));
    const pageHash = await sha256Digest(text);
    const units = planMarkdownUnits(text);
    const metadata = {
      url: safeUrl(page.canonicalUrl ?? page.url),
      pathname: page.pathname,
      title: page.title ?? page.metadata?.title ?? '',
      locale: page.locale ?? null,
      language: page.language ?? null,
      contentVersion: page.version ?? null,
      versionGroup: page.versionGroup ?? null,
      section: page.section ?? page.metadata?.section ?? null,
    };
    /** @param {'page'|'chunk'} kind @param {string} value @param {number|null} chunkIndex @param {string[]} headings @param {boolean} oversized */
    const record = async (kind, value, chunkIndex, headings, oversized) => ({
      version: /** @type {const} */ (1), kind,
      id: kind === 'page' ? pageId : `${pageId}:chunk:${String(chunkIndex).padStart(4, '0')}`,
      pageId, chunkIndex, text: value, tokenCount: await input.count(value),
      tokenizer: { ...input.tokenizer }, hash: await sha256Digest(value), pageHash,
      headings, oversized, metadata: { ...metadata },
    });
    records.push(await record('page', text, null, units.flatMap((unit) => unit.headings), false));
    /** @type {typeof units} */
    let pending = [];
    let chunkIndex = 0;
    /** @type {Array<{ level: number; text: string }>} */
    let activeHeadings = [];
    /** @type {string[]} */
    let chunkHeadings = [];
    const joined = (/** @type {typeof units} */ items) => items.map((unit) => unit.text).join('\n\n');
    const flush = async () => {
      if (!pending.length) return;
      const value = joined(pending);
      const oversized = await input.count(value) > input.maxTokens;
      records.push(await record('chunk', value, ++chunkIndex, [...new Set(chunkHeadings)], oversized));
      if (oversized) diagnostics.push({ code: 'rag-chunk-over-budget', severity: 'warning',
        pathname: page.pathname, message: 'An indivisible Markdown unit exceeds the RAG token budget and was retained whole.' });
      pending = []; chunkHeadings = [];
    };
    for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      if (unit.sectionStart && pending.length) {
        let end = index + 1;
        while (end < units.length && !units[end].sectionStart) end++;
        const section = units.slice(index, end);
        if (await input.count(joined(section)) <= input.maxTokens &&
          await input.count(joined([...pending, ...section])) > input.maxTokens) await flush();
      }
      if (pending.length && await input.count(joined([...pending, unit])) > input.maxTokens) await flush();
      for (const heading of unit.headings) {
        const level = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(heading)?.[1].length ?? (/\n {0,3}=+/.test(heading) ? 1 : 2);
        activeHeadings = activeHeadings.filter((entry) => entry.level < level);
        activeHeadings.push({ level, text: heading });
      }
      if (!pending.length) chunkHeadings = activeHeadings.map((entry) => entry.text);
      chunkHeadings.push(...unit.headings);
      pending.push(unit);
      if (await input.count(joined(pending)) > input.maxTokens) await flush();
    }
    await flush();
  }
  return { records, diagnostics };
}

/** Replacements may enrich flat metadata; identity, text and measurements are
 * immutable. Content changes belong in page:transform before block planning.
 * Every replacement is checked before a subsequent hook can observe it.
 * @param {unknown} value @param {RagRecord} original
 */
export function validateRagReplacement(value, original) {
  if (!isRagRecord(value)) return false;
  const { metadata: _old, ...protectedFields } = original;
  const { metadata: _new, ...replacement } = value;
  return canonicalJson(protectedFields) === canonicalJson(replacement) &&
    ['url', 'pathname', 'locale', 'language', 'contentVersion', 'versionGroup'].every((key) =>
      value.metadata[key] === original.metadata[key]);
}

/** @param {unknown} value @returns {value is RagRecord} */
export function isRagRecord(value) {
  if (!plain(value)) return false;
  const item = /** @type {any} */ (value);
  const fields = ['version','kind','id','pageId','chunkIndex','text','tokenCount','tokenizer','hash','pageHash','headings','oversized','metadata'];
  return Object.keys(item).length === fields.length + (Object.hasOwn(item,'tokenizerFallback') ? 1 : 0) && fields.every((key) => Object.hasOwn(item, key)) &&
    item.version === 1 && ['page','chunk'].includes(item.kind) && /^page:[a-f\d]{64}$/.test(item.pageId) &&
    item.id === (item.kind === 'page' ? item.pageId : `${item.pageId}:chunk:${String(item.chunkIndex).padStart(4, '0')}`) &&
    (item.kind === 'page' ? item.chunkIndex === null : Number.isSafeInteger(item.chunkIndex) && item.chunkIndex > 0) &&
    typeof item.text === 'string' && !item.text.includes('\r') && Number.isSafeInteger(item.tokenCount) && item.tokenCount >= 0 &&
    plain(item.tokenizer) && Object.keys(item.tokenizer).length === 3 &&
    typeof item.tokenizer.name === 'string' && !!item.tokenizer.name && typeof item.tokenizer.version === 'string' && !!item.tokenizer.version &&
    typeof item.tokenizer.approximate === 'boolean' && /^sha256:[a-f\d]{64}$/.test(item.hash) && /^sha256:[a-f\d]{64}$/.test(item.pageHash) &&
    Array.isArray(item.headings) && item.headings.every((/** @type {unknown} */ heading) => typeof heading === 'string') &&
    typeof item.oversized === 'boolean' && (item.tokenizerFallback === undefined ||
      plain(item.tokenizerFallback) && Object.keys(item.tokenizerFallback).length === 1 && ['preflight','count'].includes(item.tokenizerFallback.reason)) && plain(item.metadata) &&
    ['url','pathname','title','locale','language','contentVersion','versionGroup','section'].every((key) => Object.hasOwn(item.metadata,key)) &&
    typeof item.metadata.url === 'string' && typeof item.metadata.title === 'string' && typeof item.metadata.pathname === 'string' && inspectRootPathname(item.metadata.pathname) !== null &&
    ['locale','language','contentVersion','versionGroup','section'].every((key) => item.metadata[key] === null || typeof item.metadata[key] === 'string') &&
    Object.entries(item.metadata).every(([key, entry]) => /^[A-Za-z][A-Za-z\d_]{0,63}$/.test(key) &&
      (entry === null || typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)));
}

/** @param {readonly RagRecord[]} records */
export function serializeRagRecords(records) {
  return records.map((record) => canonicalJson(record)).join('\n') + (records.length ? '\n' : '');
}

/** @param {any} page */
function identity(page) {
  return { url: safeUrl(page.canonicalUrl ?? page.url), pathname: inspectRootPathname(page.pathname)?.decoded ?? page.pathname,
    locale: page.locale ?? null, version: page.version ?? null };
}
/** Only public canonical URL components enter metadata; no credentials/query/fragment.
 * @param {unknown} raw */
function safeUrl(raw) {
  if (typeof raw !== 'string') throw new TypeError('RAG records require a canonical URL.');
  const url = new URL(raw);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('RAG canonical URL must be public HTTP(S).');
  url.search = ''; url.hash = ''; return url.href;
}
/** @param {unknown} value */
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

/** @param {any} page */
export function isRagEligible(page) {
  return !page.corpusExcluded && page.directives?.index !== false && page.directives?.includeInLlms !== false &&
    page.directives?.includeInLlmsFull !== false && !(page.aeoTokens ?? []).some((/** @type {string} */ token) =>
      ['noindex','no-llms','no-llms-full'].includes(token));
}

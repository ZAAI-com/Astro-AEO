// @ts-check
import { sha256Hex } from './corpus-manifest.js';
import { normalizePublishedText } from './corpus-tokenizer.js';

/**
 * Scan Markdown into indivisible headings, paragraphs, and fenced code blocks.
 * Blank lines delimit blocks but are not returned. An unclosed fence consumes
 * the rest of the document, which is safer than splitting code-like content.
 *
 * @param {string} markdown
 * @returns {Array<{ kind: 'heading' | 'paragraph' | 'fence'; text: string; startLine: number; endLine: number }>}
 */
export function scanMarkdownBlocks(markdown) {
  const lines = normalizePublishedText(markdown).split('\n');
  /** @type {Array<{ kind: 'heading' | 'paragraph' | 'fence'; text: string; startLine: number; endLine: number }>} */
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].trim() === '') {
      index++;
      continue;
    }

    const start = index;
    const fence = openingFence(lines[index]);
    if (fence) {
      index++;
      while (index < lines.length) {
        if (closesFence(lines[index], fence)) {
          index++;
          break;
        }
        index++;
      }
      blocks.push(block('fence', lines, start, index));
      continue;
    }

    if (isHeading(lines[index])) {
      index++;
      blocks.push(block('heading', lines, start, index));
      continue;
    }

    index++;
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !isHeading(lines[index]) &&
      !openingFence(lines[index])
    ) {
      index++;
    }
    blocks.push(block('paragraph', lines, start, index));
  }

  return blocks;
}

/**
 * The unhashed, human-readable portion of a section slug.
 * @param {string} rawTitle
 */
export function sectionSlugBase(rawTitle) {
  const ascii = rawTitle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return ascii.match(/[a-z0-9]+/g)?.join('-') || 'section';
}

/**
 * Resolve a slug for every input title. Repeated identical raw titles share a
 * slug. If distinct titles collide after normalization, every colliding title
 * receives a SHA-256 suffix of at least eight hex characters.
 *
 * @param {readonly string[]} rawTitles
 * @returns {Promise<string[]>}
 */
export async function resolveSectionSlugs(rawTitles) {
  /** @type {Map<string, string[]>} */
  const byBase = new Map();
  for (const title of new Set(rawTitles)) {
    const base = sectionSlugBase(title);
    const titles = byBase.get(base) ?? [];
    titles.push(title);
    byBase.set(base, titles);
  }

  /** @type {Map<string, string>} */
  const resolved = new Map();
  for (const [base, titles] of byBase) {
    if (titles.length === 1) {
      resolved.set(titles[0], base);
      continue;
    }

    const hashes = new Map(await Promise.all(titles.map(async (title) => /** @type {[string, string]} */ ([
      title,
      await sha256Hex(title),
    ]))));
    let length = 8;
    while (length < 64) {
      const prefixes = titles.map((title) => hashes.get(title)?.slice(0, length));
      if (new Set(prefixes).size === prefixes.length) break;
      length++;
    }
    const finalPrefixes = titles.map((title) => hashes.get(title)?.slice(0, length));
    if (new Set(finalPrefixes).size !== finalPrefixes.length) {
      throw new Error(`SHA-256 could not disambiguate section slug "${base}".`);
    }
    for (const title of titles) resolved.set(title, `${base}-${hashes.get(title)?.slice(0, length)}`);
  }

  return rawTitles.map((title) => /** @type {string} */ (resolved.get(title)));
}

/** @param {number} part */
export function formatChunkPart(part) {
  if (!Number.isSafeInteger(part) || part < 1) throw new RangeError('Chunk part must be a positive safe integer.');
  return String(part).padStart(4, '0');
}

/**
 * @param {{ locale?: string | null; sectionSlug: string; part: number }} input
 */
export function chunkPathname(input) {
  const prefix = input.locale ? `/${input.locale}/llms` : '/llms';
  return `${prefix}/${input.sectionSlug}-${formatChunkPart(input.part)}.txt`;
}

/** @param {'heading'|'paragraph'|'fence'} kind @param {string[]} lines @param {number} start @param {number} end */
function block(kind, lines, start, end) {
  return {
    kind,
    text: lines.slice(start, end).join('\n'),
    startLine: start + 1,
    endLine: end,
  };
}

/** @param {string} line */
function isHeading(line) {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line);
}

/** @param {string} line */
function openingFence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

/** @param {string} line @param {{ marker: string; length: number }} fence */
function closesFence(line, fence) {
  const escaped = fence.marker === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${escaped}{${fence.length},}[ \\t]*$`).test(line);
}

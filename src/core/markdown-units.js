// @ts-check
import { scanMarkdownBlocks } from './corpus-blocks.js';

/** Heading-aware indivisible units shared by corpus and record planners.
 * Consecutive headings travel with their first content block. A trailing
 * heading belongs to the prior unit rather than a heading-only new chunk.
 * @param {string} markdown
 */
export function planMarkdownUnits(markdown) {
  const blocks = scanMarkdownBlocks(markdown);
  /** @type {Array<{ text: string; startLine: number; endLine: number; sectionStart: boolean; headings: string[] }>} */
  const units = [];
  /** @type {typeof blocks} */
  let headings = [];
  for (const block of blocks) {
    if (block.kind === 'heading') { headings.push(block); continue; }
    units.push({ text: [...headings, block].map((item) => item.text).join('\n\n'),
      startLine: headings[0]?.startLine ?? block.startLine, endLine: block.endLine,
      sectionStart: headings.length > 0, headings: headings.map((item) => item.text) });
    headings = [];
  }
  if (headings.length) {
    const text = headings.map((item) => item.text).join('\n\n');
    const last = units.at(-1);
    if (last) { last.text += `\n\n${text}`; last.endLine = headings.at(-1)?.endLine ?? last.endLine; }
    else units.push({ text, startLine: headings[0].startLine,
      endLine: headings.at(-1)?.endLine ?? headings[0].endLine,
      sectionStart: true, headings: headings.map((item) => item.text) });
  }
  return units;
}

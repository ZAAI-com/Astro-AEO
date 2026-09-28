// @ts-check
import { FixRefusal, MARKDOWN_MIME } from './shared.js';

export const START_MARKER = '# astro-aeo:start markdown-mime';
export const END_MARKER = '# astro-aeo:end markdown-mime';

/**
 * Maintain one managed block in a `_headers` file (Cloudflare Pages, Netlify).
 * Every byte outside the block is preserved, including the file's line endings.
 *
 * @param {string} text Current contents, or `''` for a file that does not exist.
 * @returns {import('./shared.js').FixResult}
 */
export function fixHeadersFile(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (line.trim() === START_MARKER ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === END_MARKER ? [index] : []));
  if (starts.length > 1 || ends.length > 1 || starts.length !== ends.length || (starts.length === 1 && ends[0] < starts[0])) {
    throw new FixRefusal('the astro-aeo markers in _headers are duplicated, unpaired or out of order; repair them by hand');
  }
  const block = [START_MARKER, '/*.md', `  Content-Type: ${MARKDOWN_MIME}`, END_MARKER];

  if (starts.length === 1) {
    const next = [...lines.slice(0, starts[0]), ...block, ...lines.slice(ends[0] + 1)].join(newline);
    return next === text ? { status: 'unchanged', text } : { status: 'changed', text: next };
  }

  // A rule for the same path outside the block would fight the managed one.
  const outside = lines.some((line, index) =>
    /^\/\*\.md\s*$/.test(line) ||
    (/^\s+content-type\s*:/i.test(line) && /\.md\s*$/.test(precedingPath(lines, index))));
  if (outside) {
    throw new FixRefusal('_headers already sets headers for .md paths outside an astro-aeo block; merge them by hand');
  }
  const body = text === '' || /\r?\n$/.test(text) ? text : `${text}${newline}`;
  const separator = body === '' || /(?:\r?\n){2}$/.test(body) ? '' : newline;
  return { status: 'changed', text: `${body}${separator}${block.join(newline)}${newline}` };
}

/** @param {string[]} lines @param {number} index */
function precedingPath(lines, index) {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (lines[cursor].trim() !== '' && !/^\s/.test(lines[cursor]) && !lines[cursor].startsWith('#')) return lines[cursor];
  }
  return '';
}

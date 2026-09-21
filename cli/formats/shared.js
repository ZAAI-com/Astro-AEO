// @ts-check

/** @typedef {import('../../src/index.js').Finding} Finding */

/** Where a finding points, for a human reader. @param {Finding} finding */
export function place(finding) {
  const position = finding.location ? `:${finding.location.line}${finding.location.column ? `:${finding.location.column}` : ''}` : '';
  return finding.file ? `${finding.file}${position}` : finding.url ?? '';
}

/**
 * Report text reaches terminals and logs. Control characters (including the
 * escape that starts a terminal sequence) are replaced so audited content cannot
 * repaint a screen or forge a log line. Line breaks and tabs become one space.
 *
 * @param {string} value
 */
export function printable(value) {
  let output = '';
  let spaced = false;
  for (const character of value) {
    const code = /** @type {number} */ (character.codePointAt(0));
    if (code === 9 || code === 10 || code === 13) {
      if (!spaced) output += ' ';
      spaced = true;
      continue;
    }
    spaced = false;
    const control = code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
    output += control ? '?' : character;
  }
  return output;
}

/** @param {string} value */
export function escapeXml(value) {
  return printable(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

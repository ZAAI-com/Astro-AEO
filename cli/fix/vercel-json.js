// @ts-check
import { FixRefusal, MARKDOWN_MIME } from './shared.js';

export const VERCEL_SOURCE = '/(.*)\\.md';

/**
 * Add one `headers` rule to `vercel.json`. The document is re-serialized with its
 * own indentation and line endings; every unknown field and the order of keys
 * are kept. `vercel.json` is strict JSON, so a file with comments is refused
 * rather than having them stripped.
 *
 * @param {string} text Current contents, or `''` for a file that does not exist.
 * @returns {import('./shared.js').FixResult}
 */
export function fixVercelJson(text) {
  /** @type {any} */
  let document = {};
  if (text.trim() !== '') {
    try {
      document = JSON.parse(text);
    } catch {
      throw new FixRefusal('vercel.json is not valid JSON (comments are not supported there); repair it by hand');
    }
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new FixRefusal('vercel.json must contain a JSON object');
  }
  if (document.headers !== undefined && !Array.isArray(document.headers)) {
    throw new FixRefusal('vercel.json "headers" is not an array');
  }
  const rule = { source: VERCEL_SOURCE, headers: [{ key: 'Content-Type', value: MARKDOWN_MIME }] };
  const headers = document.headers ?? [];
  const index = headers.findIndex((/** @type {any} */ entry) => entry?.source === VERCEL_SOURCE);
  if (index >= 0) {
    const existing = headers[index];
    const list = Array.isArray(existing.headers) ? existing.headers : null;
    const contentTypes = (list ?? []).filter((/** @type {any} */ header) => String(header?.key).toLowerCase() === 'content-type');
    if (!list || contentTypes.length > 1 || existing.has || existing.missing) {
      throw new FixRefusal(`vercel.json already has a conditional or malformed rule for ${VERCEL_SOURCE}; merge it by hand`);
    }
    if (contentTypes.length === 1 && contentTypes[0].value === MARKDOWN_MIME) return { status: 'unchanged', text };
    if (contentTypes.length === 1) contentTypes[0].value = MARKDOWN_MIME;
    else list.push(rule.headers[0]);
  } else {
    const competing = headers.some((/** @type {any} */ entry) =>
      typeof entry?.source === 'string' && /\.md\b|\\\.md/.test(entry.source) &&
      (entry.headers ?? []).some((/** @type {any} */ header) => String(header?.key).toLowerCase() === 'content-type'));
    if (competing) throw new FixRefusal('vercel.json already sets Content-Type for another .md pattern; merge it by hand');
    document.headers = [...headers, rule];
  }
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  ';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const serialized = JSON.stringify(document, null, indent).replace(/\n/g, newline);
  return { status: 'changed', text: `${serialized}${text === '' || /\r?\n$/.test(text) ? newline : ''}` };
}

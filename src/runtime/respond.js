// @ts-check

/**
 * Response construction for the runtime.
 *
 * Web APIs only (`Response`, `crypto.subtle`, `TextEncoder`), because this is
 * bundled into the consumer's SSR output and has to run unchanged on Node and on
 * an edge runtime.
 */

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/**
 * A weak-ish ETag over the body. SHA-256 via Web Crypto rather than a node hash,
 * so the same code runs everywhere.
 * @param {string} body
 * @returns {Promise<string>}
 */
export async function etagFor(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

/**
 * Whether the client already has this exact body.
 *
 * Compares against every tag in `If-None-Match` rather than the whole header, so
 * a client that legitimately sends a list is not forced to re-download.
 * @param {Request} request
 * @param {string} etag
 * @returns {boolean}
 */
export function isNotModified(request, etag) {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

/**
 * Build a response, honouring conditional requests and HEAD.
 *
 * @param {object} input
 * @param {string} input.body
 * @param {string} input.contentType
 * @param {Request} input.request
 * @param {number} [input.status]
 * @param {Record<string, string>} [input.headers]  Extra headers, e.g. Vary or Link.
 * @returns {Promise<Response>}
 */
export async function textResponse({ body, contentType, request, status = 200, headers = {} }) {
  const etag = await etagFor(body);
  const base = { 'content-type': contentType, etag, ...headers };

  if (isNotModified(request, etag)) {
    // 304 carries no body and must not restate content-type.
    const { 'content-type': _omit, ...revalidation } = base;
    return new Response(null, { status: 304, headers: revalidation });
  }

  // HEAD must produce the same headers as GET with no body. Constructing the
  // response with the body and discarding it keeps the two from diverging.
  const isHead = request.method === 'HEAD';
  return new Response(isHead ? null : body, { status, headers: base });
}

/**
 * Copy the caching intent of the page a representation was derived from, so a
 * `.md` companion is not cached differently from its own HTML.
 * @param {Response | undefined} source
 * @returns {Record<string, string>}
 */
export function inheritedCacheHeaders(source) {
  /** @type {Record<string, string>} */
  const headers = {};
  const cacheControl = source?.headers.get('cache-control');
  if (cacheControl) headers['cache-control'] = cacheControl;
  return headers;
}

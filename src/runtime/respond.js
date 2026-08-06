// @ts-check

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/**
 * Statuses whose responses cannot carry a body under the Fetch standard.
 * @param {number} status
 * @returns {boolean}
 */
export function isNullBodyStatus(status) {
  return status === 204 || status === 205 || status === 304;
}

/**
 * @param {Request} request
 * @param {number} status
 * @returns {boolean}
 */
export function responseBodyForbidden(request, status) {
  return request.method === 'HEAD' || isNullBodyStatus(status);
}

/**
 * @param {string} body
 * @returns {Promise<string>}
 */
export async function etagFor(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

/**
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
 * @param {object} input
 * @param {string} input.body
 * @param {string} input.contentType
 * @param {Request} input.request
 * @param {number} [input.status]
 * @param {HeadersInit} [input.headers]
 * @returns {Promise<Response>}
 */
export async function textResponse({ body, contentType, request, status = 200, headers = {} }) {
  const etag = await etagFor(body);
  const base = new Headers(headers);
  base.set('content-type', contentType);
  base.set('etag', etag);
  base.delete('content-length');
  base.delete('content-encoding');
  base.delete('content-range');
  base.delete('accept-ranges');

  if (status >= 200 && status < 300 && isNotModified(request, etag)) {
    const revalidation = new Headers(base);
    revalidation.delete('content-type');
    return new Response(null, { status: 304, headers: revalidation });
  }

  return new Response(responseBodyForbidden(request, status) ? null : body, {
    status,
    headers: base,
  });
}

/**
 * @param {Response | undefined} source
 * @returns {Headers}
 */
export function inheritedRepresentationHeaders(source) {
  const headers = new Headers(source?.headers);
  for (const name of [
    'content-type',
    'content-length',
    'content-encoding',
    'content-range',
    'accept-ranges',
    'etag',
  ]) {
    headers.delete(name);
  }
  return headers;
}

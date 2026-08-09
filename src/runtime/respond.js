// @ts-check

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

const REPRESENTATION_METADATA = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-range',
  'accept-ranges',
  'etag',
  'content-digest',
  'repr-digest',
  'digest',
  'content-md5',
];

/**
 * @param {Response} response
 * @returns {string | null}
 */
export function mediaType(response) {
  const value = response.headers.get('content-type');
  if (!value) return null;
  const type = value.split(';', 1)[0].trim().toLowerCase();
  return /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+$/.test(type) ? type : null;
}

/** @param {Response} response @returns {boolean} */
export function isHtmlResponse(response) {
  const type = mediaType(response);
  return type === 'text/html' || type === 'application/xhtml+xml';
}

/**
 * Response.text() always decodes as UTF-8. Treat a declared legacy charset as
 * opaque bytes so ordinary requests can forward it unchanged and generated
 * representations can skip it safely.
 * @param {Response} response
 * @returns {boolean}
 */
export function isUtf8HtmlResponse(response) {
  if (!isHtmlResponse(response)) return false;
  const value = response.headers.get('content-type') ?? '';
  const declarations = [...value.matchAll(/;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s"]+))/gi)];
  if (declarations.length === 0) return !/;\s*charset\s*=/i.test(value);
  return declarations.every((match) => {
    const charset = (match[1] ?? match[2] ?? '').trim().toLowerCase();
    return charset === 'utf-8' || charset === 'utf8';
  });
}

/**
 * A transformed string response is encoded as UTF-8 by the Fetch implementation.
 * Preserve the source HTML media type, but never a stale source charset.
 * @param {Response} response
 * @returns {string}
 */
export function transformedHtmlContentType(response) {
  const type = mediaType(response);
  return `${type === 'application/xhtml+xml' ? type : 'text/html'}; charset=utf-8`;
}

/** @param {Response} response @returns {boolean} */
export function isIdentityEncoded(response) {
  const value = response.headers.get('content-encoding');
  if (!value) return true;
  const codings = value.split(',').map((coding) => coding.trim().toLowerCase());
  return codings.length > 0 && codings.every((coding) => coding === 'identity');
}

/**
 * Remove metadata that describes bytes which a generated representation replaces.
 * @param {Headers} headers
 * @returns {Headers}
 */
export function stripRepresentationMetadata(headers) {
  for (const name of REPRESENTATION_METADATA) headers.delete(name);
  return headers;
}

/**
 * Release a response stream when Astro-AEO replaces or skips its bytes.
 * @param {Response | null | undefined} response
 * @returns {void}
 */
export function cancelResponseBody(response) {
  if (!response?.body || response.bodyUsed) return;
  try {
    // Application-controlled cancellation may never settle. Invoke it so the
    // stream is disturbed, but never let its promise hold a request open.
    void response.body.cancel().catch(() => {});
  } catch {}
}

/** @param {number} status @returns {number} */
export function generatedStatus(status) {
  return status === 206 ? 200 : status;
}

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
  const effectiveStatus = generatedStatus(status);
  const base = stripRepresentationMetadata(new Headers(headers));
  base.set('content-type', contentType);
  base.set('etag', etag);

  if (effectiveStatus >= 200 && effectiveStatus < 300 && isNotModified(request, etag)) {
    const revalidation = new Headers(base);
    revalidation.delete('content-type');
    return new Response(null, { status: 304, headers: revalidation });
  }

  return new Response(responseBodyForbidden(request, effectiveStatus) ? null : body, {
    status: effectiveStatus,
    headers: base,
  });
}

/**
 * @param {Response | undefined} source
 * @returns {Headers}
 */
export function inheritedRepresentationHeaders(source) {
  return stripRepresentationMetadata(new Headers(source?.headers));
}

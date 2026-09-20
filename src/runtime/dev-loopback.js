// @ts-check
/**
 * Development-only fallback for a failed in-process rewrite.
 *
 * Astro's `findRouteToRewrite` can select the wrong route for an internal
 * rewrite when two dynamic route patterns overlap, so a page that renders
 * perfectly well over HTTP cannot be reached through `state.rewrite()`. The
 * page itself is fine, so development re-requests that one path from the
 * address Astro reported at startup.
 *
 * This is the one documented exception to "no network destination is derived
 * from a request". The destination is never taken from the Host header or any
 * other caller input, this module is generated only for `astro dev`, and the
 * transport is reached only after an in-process rewrite has already thrown.
 */

const INTERNAL_PURPOSE_HEADER = 'x-astro-aeo-internal-purpose';
const LOOPBACK_NONCE_HEADER = 'x-astro-aeo-loopback';
const CORPUS_PURPOSE = 'corpus';

/** @typedef {{ origin: string; nonce: string }} DevLoopback */
/** @typedef {{ load: () => Promise<{ LOOPBACK: DevLoopback | null }> }} DevLoopbackSource */

export { LOOPBACK_NONCE_HEADER };

/**
 * Re-request one known page over the development server's own address.
 *
 * @param {DevLoopback} loopback
 * @param {string} target the base-prefixed, public pathname with any query
 * @returns {Promise<import('./serve.js').HtmlLoad | null>}
 */
export async function loopbackFetchHtml(loopback, target) {
  let url;
  try {
    url = new URL(target, loopback.origin);
  } catch {
    return null;
  }
  // The destination is fixed. A target that resolved elsewhere is not ours.
  if (url.origin !== new URL(loopback.origin).origin) return null;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      // Anonymous by construction: no caller headers, no cookies, no redirects.
      headers: {
        [INTERNAL_PURPOSE_HEADER]: CORPUS_PURPOSE,
        [LOOPBACK_NONCE_HEADER]: loopback.nonce,
        'cache-control': 'no-store',
      },
      redirect: 'manual',
    });
  } catch {
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('text/html')) {
    try {
      await response.arrayBuffer();
    } catch {
      /* the body is already unusable */
    }
    return null;
  }
  try {
    return { response, html: await response.text() };
  } catch {
    return null;
  }
}


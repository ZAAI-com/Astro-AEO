// @ts-check
import { COLLECT_FLAG, INFERRED_MARKER, MARKER_MIME } from '../core/extract/marker.js';
import { serializeJsonLd } from '../lib/serialize-jsonld.js';
import { starlightMarker } from './marker.js';
// @ts-ignore The options module exists only inside a Starlight project's Vite graph.
import options from 'virtual:astro-aeo/starlight-options';

/**
 * Starlight route middleware. It adds the inferred source marker to the page
 * head only while Astro-AEO itself is collecting the page, exactly like
 * `<AeoPage>`: an ordinary visitor never receives a page's source. The marker is
 * removed again by the same redaction pass that removes authored markers.
 *
 * @param {import('astro').APIContext} context
 * @param {() => Promise<void>} next
 */
export async function onRequest(context, next) {
  await next();
  const locals = /** @type {any} */ (context.locals);
  if (!locals?.[COLLECT_FLAG]) return;
  const route = locals.starlightRoute;
  const marker = starlightMarker(route, options);
  if (!marker || !Array.isArray(route?.head)) return;
  route.head.push({
    tag: 'script',
    attrs: { type: MARKER_MIME, 'data-astro-aeo-marker': INFERRED_MARKER },
    content: serializeJsonLd(marker),
  });
}

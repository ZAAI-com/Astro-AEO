// @ts-check
import { createEdgePlugin } from './plugin.js';

export { createCloudflareHandler } from '../runtime/edge/cloudflare.js';

/** Add to `aeo({ plugins: [...] })` on a fully static site deployed to Cloudflare. */
export function cloudflareEdge() {
  return createEdgePlugin('cloudflare');
}

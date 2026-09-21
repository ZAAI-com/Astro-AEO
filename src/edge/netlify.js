// @ts-check
import { createEdgePlugin } from './plugin.js';

export { createNetlifyHandler } from '../runtime/edge/netlify.js';

/** Add to `aeo({ plugins: [...] })` on a fully static site deployed to Netlify. */
export function netlifyEdge() {
  return createEdgePlugin('netlify');
}

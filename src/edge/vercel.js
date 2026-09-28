// @ts-check
import { createEdgePlugin } from './plugin.js';

export { createVercelHandler } from '../runtime/edge/vercel.js';

/** Add to `aeo({ plugins: [...] })` on a fully static site deployed to Vercel. */
export function vercelEdge() {
  return createEdgePlugin('vercel');
}

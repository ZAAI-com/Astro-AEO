import type { AstroAeoPlugin } from '../index.js';
import type { EdgeHandlerOptions } from '../edge.js';

/** Add the returned plugin to `aeo({ plugins: [...] })` on a fully static site. */
export declare function netlifyEdge(): AstroAeoPlugin;

/** Netlify Edge Function: `export default createNetlifyHandler()`. */
export declare function createNetlifyHandler(
  options?: EdgeHandlerOptions,
): (request: Request, context: { next(request?: Request): Promise<Response>; waitUntil?(work: Promise<void>): void }) => Promise<Response>;

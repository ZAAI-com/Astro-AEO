import type { AstroAeoPlugin } from '../index.js';
import type { EdgeHandlerOptions } from '../edge.js';

/** Add the returned plugin to `aeo({ plugins: [...] })` on a fully static site. */
export declare function vercelEdge(): AstroAeoPlugin;

/** Vercel Routing Middleware. Pass `next` and `rewrite` from `@vercel/functions`. */
export declare function createVercelHandler(options: EdgeHandlerOptions & {
  next(init?: { headers?: Record<string, string> }): Response;
  rewrite(destination: string | URL, init?: { headers?: Record<string, string> }): Response;
  fetch?: typeof fetch;
  waitUntil?(work: Promise<void>): void;
}): (request: Request) => Promise<Response>;

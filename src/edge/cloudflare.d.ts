import type { AstroAeoPlugin } from '../index.js';
import type { EdgeHandlerOptions } from '../edge.js';

/** Add the returned plugin to `aeo({ plugins: [...] })` on a fully static site. */
export declare function cloudflareEdge(): AstroAeoPlugin;

export interface CloudflareEdgeHandler {
  /** Pages Functions middleware: `export const onRequest = handler.onRequest`. */
  onRequest(context: { request: Request; env: unknown; next(): Promise<Response>; waitUntil?(work: Promise<void>): void }): Promise<Response>;
  /** Worker with a static assets binding: `export default { fetch: handler.fetch }`. */
  fetch(request: Request, env: unknown, context?: { waitUntil?(work: Promise<void>): void }): Promise<Response>;
}

export declare function createCloudflareHandler(
  options?: EdgeHandlerOptions & { /** Default `ASSETS`. */ assetsBinding?: string },
): CloudflareEdgeHandler;

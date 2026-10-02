/** The public build artifact at `/.well-known/astro-aeo-edge-v1.json` (below the site base). */
export interface StaticEdgeManifestV1 {
  version: 1;
  provider: 'cloudflare' | 'netlify' | 'vercel';
  /** `markdown.negotiation` at build time. */
  mode: 'response' | 'redirect';
  base: string;
  /** Explicit Markdown cache policy; omission inherits the companion policy. */
  cacheControl?: string;
  /** Sorted by `html`. Only pages whose companion the build really emitted. */
  routes: { html: string; markdown: string }[];
}

export type EdgeDecision =
  | { kind: 'pass' }
  | { kind: 'html' }
  | { kind: 'redirect'; location: string }
  | { kind: 'markdown'; pathname: string };

export interface EdgeManifestIndex {
  mode: 'response' | 'redirect';
  cacheControl?: string;
  routes: Map<string, string>;
}

export declare const EDGE_MANIFEST_PATHNAME: '/.well-known/astro-aeo-edge-v1.json';
/** Validate an untrusted manifest. `null` for anything unexpected. */
export declare function readEdgeManifest(value: unknown): EdgeManifestIndex | null;
/** The representation decision for one request, with the same Accept semantics as the Astro middleware. */
export declare function decideEdgeRepresentation(request: Request, manifest: EdgeManifestIndex | null): EdgeDecision;
export declare function withVaryAccept(response: Response): Response;
/** Build a negotiator for a host that can fetch a static asset and continue to the origin response. */
export declare function createEdgeNegotiator<C = undefined>(host: {
  fetchAsset(pathname: string, request: Request, context: C): Promise<Response>;
  base?: string;
}): (request: Request, next: () => Promise<Response>, context?: C) => Promise<Response>;

export interface EdgeHandlerOptions {
  /** The Astro `base`, when the site is not served from the root. */
  base?: string;
}

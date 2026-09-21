// @ts-check
import { compareCodeUnits } from '../core/corpus-manifest.js';
import { EDGE_MANIFEST_PATHNAME } from '../runtime/edge/handler.js';

export const EDGE_MANIFEST_ROUTE = EDGE_MANIFEST_PATHNAME;

/**
 * The public edge manifest: every page whose companion the build really emitted,
 * by its served HTML pathname. Computed after ownership arbitration, so a
 * companion a project route or public file displaced is never advertised.
 *
 * @param {{
 *   pages: readonly { url: string; mdHref: string }[];
 *   provider: string;
 *   mode: 'response' | 'redirect';
 *   base: string;
 *   emitted: (pathname: string, owner: string) => boolean;
 * }} input
 */
export function serializeEdgeManifest(input) {
  const routes = input.pages
    .filter((page) => input.emitted(page.mdHref, 'dotmd'))
    .map((page) => ({ html: new URL(page.url).pathname, markdown: page.mdHref }))
    .sort((left, right) => compareCodeUnits(left.html, right.html));
  return `${JSON.stringify({
    version: 1,
    provider: input.provider,
    mode: input.mode,
    base: input.base || '/',
    routes,
  })}\n`;
}

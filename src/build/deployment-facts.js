// @ts-check
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** @param {string} projectRoot */
export function deploymentFactsPath(projectRoot) {
  return join(projectRoot, '.astro', 'aeo-cache', 'deployment-v1.json');
}

/**
 * What this build was configured to deploy as, for `astro-aeo doctor` and
 * `audit`. Private (mode 0o600), and deliberately small: names and modes only,
 * no absolute path, no environment value, no secret. The ownership digest lets a
 * reader detect that the two private files come from different builds.
 *
 * @param {{
 *   output: 'static' | 'server';
 *   adapter: string | null;
 *   base: string;
 *   buildFormat: string;
 *   trailingSlash: string;
 *   negotiation: string;
 *   edgeProvider: string | null;
 *   ownership: readonly { pathname: string; status: string }[];
 * }} facts
 */
export function serializeDeploymentFacts(facts) {
  const ownership = facts.ownership.map((entry) => `${entry.status} ${entry.pathname}`).sort().join('\n');
  return `${JSON.stringify({
    version: 1,
    output: facts.output,
    adapter: facts.adapter,
    base: facts.base || '/',
    buildFormat: facts.buildFormat,
    trailingSlash: facts.trailingSlash,
    negotiation: facts.negotiation,
    edgeProvider: facts.edgeProvider,
    ownershipDigest: `sha256:${createHash('sha256').update(ownership).digest('hex')}`,
  }, null, 2)}\n`;
}

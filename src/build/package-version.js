// @ts-check
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * @typedef {{ name: 'astro-aeo'; version: string; dependencies: { turndown: string; linkedom: string } }} ExtractionProducer
 */

/**
 * Read astro-aeo's own published version, shared by the CLI and the
 * processing cache. Returns undefined when the package file is unreadable so
 * each caller chooses its own fallback.
 *
 * @returns {string | undefined}
 */
export function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Identify the code that produces extraction results: astro-aeo itself plus
 * the two libraries that parse and convert page HTML. A lockfile refresh of
 * either dependency changes the output as surely as an astro-aeo release, so
 * all three versions take part in the processing cache key.
 *
 * @returns {ExtractionProducer}
 */
export function extractionProducer() {
  return {
    name: 'astro-aeo',
    version: readPackageVersion() ?? 'unknown',
    dependencies: {
      turndown: dependencyVersion('turndown'),
      linkedom: dependencyVersion('linkedom'),
    },
  };
}

/**
 * turndown has no exports map and linkedom exports `./package.json`, so both
 * resolve their manifest from here.
 *
 * @param {string} name
 * @returns {string}
 */
function dependencyVersion(name) {
  try {
    const pkg = createRequire(import.meta.url)(`${name}/package.json`);
    return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

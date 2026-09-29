// @ts-check
import { readFileSync } from 'node:fs';

/**
 * Read the published package version so cache state can name its producer.
 * The fallback keeps a build running when the package file is unreadable.
 *
 * @returns {string}
 */
export function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

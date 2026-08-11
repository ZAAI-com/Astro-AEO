// @ts-check
import { isAbsolute, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AeoConfigError } from '../lib/errors.js';

const FILE_URL = /^file:/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * Resolve the runtime half of configured plugins into literal imports for the
 * consumer's Vite graph. Relative paths belong to the Astro project root and
 * bare specifiers remain package imports. Remote URL modules are rejected so
 * plugin loading can never become a network operation.
 *
 * @param {{ version: 1; plugins: readonly { name: string; entrypoint: string; options: import('../index.js').JsonValue | null; stages: readonly string[]; claims: readonly { id: string; pathname: string; replace?: boolean }[] }[] }} manifest
 * @param {string} projectRoot
 */
export function runtimePluginModules(manifest, projectRoot) {
  return manifest.plugins.map((plugin) => ({
    name: plugin.name,
    module: plugin.entrypoint,
    specifier: resolveRuntimePluginSpecifier(plugin.entrypoint, projectRoot),
    options: plugin.options,
    stages: [...plugin.stages],
    claims: plugin.claims.map((claim) => ({ ...claim })),
  }));
}

/**
 * @param {string} value
 * @param {string} projectRoot
 */
export function resolveRuntimePluginSpecifier(value, projectRoot) {
  const specifier = value.trim();
  if (FILE_URL.test(specifier)) {
    try {
      const url = new URL(specifier);
      if (url.protocol !== 'file:') throw new TypeError('not a file URL');
      return url.href;
    } catch {
      throw new AeoConfigError(
        `astro-aeo: runtime plugin entrypoint "${value}" must be a valid local file URL.`,
      );
    }
  }
  if (specifier.startsWith('.') || isAbsolute(specifier) || win32.isAbsolute(specifier)) {
    const suffixAt = specifier.search(/[?#]/);
    const pathname = suffixAt === -1 ? specifier : specifier.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? '' : specifier.slice(suffixAt);
    const url = win32.isAbsolute(pathname) && !isAbsolute(pathname)
      ? portableWindowsFileUrl(pathname)
      : pathToFileURL(resolve(projectRoot, pathname)).href;
    return `${url}${suffix}`;
  }
  if (URL_SCHEME.test(specifier)) {
    throw new AeoConfigError(
      `astro-aeo: runtime plugin entrypoint "${value}" must be a local file or package module; remote modules are not supported.`,
    );
  }
  return specifier;
}

/**
 * Convert a Windows absolute path when validation runs on another platform.
 * On Windows, the platform-native pathToFileURL branch above owns this case.
 * @param {string} pathname
 */
function portableWindowsFileUrl(pathname) {
  const normalized = pathname.replace(/\\/g, '/');
  if (/^[a-z]:\//i.test(normalized)) return pathToFileURL(`/${normalized}`).href;
  const [host, ...segments] = normalized.replace(/^\/+/, '').split('/');
  const url = pathToFileURL(`/${segments.join('/')}`);
  url.hostname = host;
  return url.href;
}

// @ts-check
import { isAbsolute, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  corpusTokenizerOptions,
  probeCorpusTokenizer,
  validateCorpusTokenizerModule,
} from '../core/corpus-tokenizer.js';

const FILE_URL = /^file:/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const nativeImport = /** @type {(specifier: string) => Promise<any>} */ (
  new Function('specifier', 'return import(specifier)')
);

/**
 * @typedef {{ module: string; specifier: string; options?: import('../index.js').JsonValue; implementation: ReturnType<typeof validateCorpusTokenizerModule> }} LoadedCorpusTokenizer
 */

/**
 * @param {{ module: string | URL; options?: import('../index.js').JsonValue } | undefined} configured
 * @param {string} projectRoot
 * @param {{ warn: (message: string) => void }} logger
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @param {(specifier: string) => Promise<any>} [load]
 * @returns {Promise<LoadedCorpusTokenizer | undefined>}
 */
export async function preloadCorpusTokenizer(configured, projectRoot, logger, diagnostics = [], load = nativeImport) {
  if (!configured) return undefined;
  const module = configured.module instanceof URL ? configured.module.href : configured.module;
  try {
    const specifier = resolveCorpusTokenizerSpecifier(configured.module, projectRoot);
    const namespace = await load(specifier);
    const implementation = validateCorpusTokenizerModule(namespace?.default, module);
    const options = corpusTokenizerOptions(configured.options);
    await probeCorpusTokenizer(implementation, options);
    return { module, specifier, ...(options === undefined ? {} : { options }), implementation };
  } catch {
    const message = `astro-aeo: corpus tokenizer "${module}" failed preflight; corpus planning will use astro-aeo-approx@1.`;
    logger.warn(message);
    diagnostics.push({
      version: 1,
      code: 'corpus-tokenizer-load-failed',
      severity: 'warning',
      message,
      sourcePath: module,
    });
    return undefined;
  }
}

/** @param {string | URL} module @param {string} projectRoot */
export function resolveCorpusTokenizerSpecifier(module, projectRoot) {
  if (module instanceof URL) {
    if (module.protocol !== 'file:') throw new TypeError('Corpus tokenizer URL must be local.');
    return module.href;
  }
  const value = module.trim();
  if (!value) throw new TypeError('Corpus tokenizer module must be non-empty.');
  if (FILE_URL.test(value)) {
    const url = new URL(value);
    if (url.protocol !== 'file:') throw new TypeError('Corpus tokenizer URL must be local.');
    return url.href;
  }
  if (value.startsWith('.') || isAbsolute(value) || win32.isAbsolute(value)) {
    const suffixAt = value.search(/[?#]/);
    const pathname = suffixAt === -1 ? value : value.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? '' : value.slice(suffixAt);
    return `${pathToFileURL(resolve(projectRoot, pathname)).href}${suffix}`;
  }
  if (URL_SCHEME.test(value)) throw new TypeError('Remote corpus tokenizer modules are not supported.');
  return value;
}

/** @param {LoadedCorpusTokenizer | undefined} tokenizer */
export function runtimeCorpusTokenizerModule(tokenizer) {
  return tokenizer
    ? {
        module: tokenizer.module,
        specifier: tokenizer.specifier,
        name: tokenizer.implementation.name,
        version: tokenizer.implementation.version,
        approximate: tokenizer.implementation.approximate,
        ...(tokenizer.options === undefined ? {} : { options: tokenizer.options }),
      }
    : undefined;
}

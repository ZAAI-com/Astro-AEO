// @ts-check
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AeoConfigError } from '../lib/errors.js';
import {
  rendererOptions,
  validateMarkdownRendererModule,
} from '../core/markdown-renderers.js';

const FILE_URL = /^file:/i;
const REMOTE_URL = /^[a-z][a-z\d+.-]*:/i;

const nativeImport = /** @type {(specifier: string) => Promise<any>} */ (
  new Function('specifier', 'return import(specifier)')
);

/**
 * @typedef {object} LoadedMarkdownRenderer
 * @property {string} name
 * @property {string} [module]
 * @property {string} [specifier]
 * @property {boolean} inline
 * @property {import('../index.js').JsonValue} [options]
 * @property {(input: any) => unknown | Promise<unknown>} render
 */

/**
 * Preflight importable renderers before Vite creates the server graph. Failed
 * extensions are omitted so they can never break a consumer's HTML build or
 * request-time server startup.
 *
 * @param {unknown[]} configured
 * @param {string} projectRoot
 * @param {{ warn: (message: string) => void }} logger
 * @param {import('../index.js').Diagnostic[]} [diagnostics]
 * @param {(specifier: string) => Promise<any>} [load]
 * @returns {Promise<LoadedMarkdownRenderer[]>}
 */
export async function preloadMarkdownRenderers(
  configured,
  projectRoot,
  logger,
  diagnostics = [],
  load = nativeImport,
) {
  const ordered = orderMarkdownRenderers(configured);
  /** @type {LoadedMarkdownRenderer[]} */
  const loaded = [];
  const names = new Set();

  for (let index = 0; index < ordered.length; index++) {
    const configuredRenderer = ordered[index];
    if (typeof configuredRenderer === 'function') {
      const name = configuredRenderer.name || `inline-${index + 1}`;
      if (names.has(name)) {
        reportRendererFailure(diagnostics, logger, {
          code: 'markdown-renderer-duplicate-name',
          message: `astro-aeo: more than one Markdown renderer is named "${name}"; the later renderer was omitted.`,
        });
        continue;
      }
      names.add(name);
      loaded.push({
        name,
        inline: true,
        render: /** @type {(input: any) => unknown | Promise<unknown>} */ (configuredRenderer),
      });
      continue;
    }

    const descriptor = validateRendererDescriptor(configuredRenderer, index);
    const module = displayModule(descriptor.module);
    const options = rendererOptions(
      descriptor.options,
      `astro-aeo: markdown.renderers[${index}].options`,
    );
    const specifier = resolveRendererSpecifier(descriptor.module, projectRoot);

    try {
      const namespace = await load(specifier);
      const implementation = validateMarkdownRendererModule(namespace?.default, module);
      if (names.has(implementation.name)) {
        reportRendererFailure(diagnostics, logger, {
          code: 'markdown-renderer-duplicate-name',
          message:
            `astro-aeo: more than one Markdown renderer is named "${implementation.name}"; ` +
            `the renderer from "${module}" was omitted.`,
          sourcePath: module,
        });
        continue;
      }
      names.add(implementation.name);
      loaded.push({
        name: implementation.name,
        module,
        specifier,
        inline: false,
        ...(options === undefined ? {} : { options }),
        render: implementation.render,
      });
    } catch {
      reportRendererFailure(diagnostics, logger, {
        code: 'markdown-renderer-load-failed',
        message:
          `astro-aeo: Markdown renderer "${module}" failed to load and was omitted; ` +
          'rendered HTML extraction remains available.',
        sourcePath: module,
      });
    }
  }

  return loaded;
}

/**
 * The MDX adapter owns a fixed source slot regardless of where it appears in
 * configuration. All remaining renderers retain exact configuration order.
 * @param {unknown[]} configured
 * @returns {unknown[]}
 */
export function orderMarkdownRenderers(configured) {
  const mdx = [];
  const remaining = [];
  for (const renderer of configured) {
    if (isMdxDescriptor(renderer)) mdx.push(renderer);
    else remaining.push(renderer);
  }
  if (mdx.length > 1) {
    throw new AeoConfigError(
      'astro-aeo: markdown.renderers may register "astro-aeo/mdx" only once.',
    );
  }
  return [...mdx, ...remaining];
}

/**
 * Inline functions cannot cross the build/runtime module boundary. Call this
 * after routes resolve, when mixed output is finally known.
 * @param {unknown[]} configured
 * @param {{ command: 'dev'|'build'|'preview'; serverOutput: boolean; hasOnDemandPage: boolean }} environment
 */
export function assertInlineMarkdownRenderersSupported(configured, environment) {
  if (!configured.some((renderer) => typeof renderer === 'function')) return;
  if (
    environment.command !== 'build' ||
    environment.serverOutput ||
    environment.hasOnDemandPage
  ) {
    throw new AeoConfigError(
      'astro-aeo: inline markdown.renderers are supported only by fully prerendered builds. ' +
        'Use an importable { module, options } descriptor for dev, server output, or an on-demand route.',
    );
  }
}

/**
 * Keep only data the virtual module needs for literal runtime imports.
 * @param {LoadedMarkdownRenderer[]} renderers
 */
export function runtimeMarkdownRendererModules(renderers) {
  return renderers.flatMap((renderer) =>
    renderer.inline || !renderer.module || !renderer.specifier
      ? []
      : [{
          name: renderer.name,
          module: renderer.module,
          specifier: renderer.specifier,
          ...(renderer.options === undefined ? {} : { options: renderer.options }),
        }],
  );
}

/** @param {unknown} value @param {number} index */
function validateRendererDescriptor(value, index) {
  if (!isPlainObject(value) || !('module' in value)) {
    throw new AeoConfigError(
      `astro-aeo: markdown.renderers[${index}] must be a renderer function or a { module, options } descriptor.`,
    );
  }
  const module = value.module;
  if (
    !(module instanceof URL) &&
    (typeof module !== 'string' || module.trim() === '')
  ) {
    throw new AeoConfigError(
      `astro-aeo: markdown.renderers[${index}].module must be a non-empty module specifier or file URL.`,
    );
  }
  if (module instanceof URL && module.protocol !== 'file:') {
    throw new AeoConfigError(
      `astro-aeo: markdown.renderers[${index}].module must be local; remote URL modules are not supported.`,
    );
  }
  try {
    rendererOptions(value.options, `astro-aeo: markdown.renderers[${index}].options`);
  } catch (error) {
    throw new AeoConfigError(errorMessage(error));
  }
  return /** @type {{ module: string | URL; options?: unknown }} */ (value);
}

/**
 * @param {string | URL} module
 * @param {string} projectRoot
 */
export function resolveRendererSpecifier(module, projectRoot) {
  if (module instanceof URL) return module.href;
  const value = module.trim();
  if (FILE_URL.test(value)) {
    try {
      return new URL(value).href;
    } catch {
      return value;
    }
  }
  if (REMOTE_URL.test(value)) {
    throw new AeoConfigError(
      `astro-aeo: Markdown renderer "${value}" must be a local file or package module; remote modules are not supported.`,
    );
  }
  if (value.startsWith('.') || isAbsolute(value)) {
    const suffixAt = value.search(/[?#]/);
    const pathname = suffixAt === -1 ? value : value.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? '' : value.slice(suffixAt);
    return `${pathToFileURL(resolve(projectRoot, pathname)).href}${suffix}`;
  }
  return value;
}

/** @param {unknown} value */
function isMdxDescriptor(value) {
  return isPlainObject(value) && value.module === 'astro-aeo/mdx';
}

/** @param {string | URL} module */
function displayModule(module) {
  return module instanceof URL ? module.href : module.trim();
}

/**
 * @param {import('../index.js').Diagnostic[]} diagnostics
 * @param {{ warn: (message: string) => void }} logger
 * @param {{ code: string; message: string; sourcePath?: string }} finding
 */
function reportRendererFailure(diagnostics, logger, finding) {
  logger.warn(finding.message);
  diagnostics.push({ version: 1, severity: 'warning', ...finding });
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

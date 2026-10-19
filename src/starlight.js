// @ts-check
import aeo from './index.js';
import { isPageVersion } from './core/page-version.js';
import { AeoConfigError } from './lib/errors.js';
import { declareContentRoutes } from './lib/content-routes.js';

const OPTIONS_MODULE = 'virtual:astro-aeo/starlight-options';
const RESOLVED_OPTIONS_MODULE = `\0${OPTIONS_MODULE}`;

/**
 * Starlight plugin. It registers the Astro-AEO integration itself, so a project
 * lists `starlightAeo()` under Starlight's `plugins` and does not add `aeo()`.
 * Only Starlight's public plugin and route-data APIs are used.
 *
 * @param {import('./starlight.js').StarlightAeoOptions} [options]
 * @returns {import('./starlight.js').StarlightAeoPlugin}
 */
export default function starlightAeo(options = {}) {
  const versions = validateStarlightOptions(options);
  const runtime = {
    links: { pagination: options.links?.pagination !== false, edit: options.links?.edit === true,
      ...(options.links?.source ? { source: options.links.source } : {}),
      ...(options.links?.versions === true ? { versions: true } : {}) },
    techArticle: options.techArticle !== false,
    ...(versions ? { versions } : {}),
  };
  return {
    name: 'astro-aeo/starlight',
    hooks: {
      'config:setup'({ addIntegration, addRouteMiddleware, astroConfig }) {
        const integrations = /** @type {any[]} */ (astroConfig.integrations ?? []).flat(Infinity);
        if (integrations.some((integration) => integration?.name === 'astro-aeo')) {
          throw new Error(
            'astro-aeo: starlightAeo() registers the Astro-AEO integration itself. ' +
            'Remove aeo() from `integrations` and pass its options as starlightAeo({ aeo: { ... } }).',
          );
        }
        const config = starlightDefaults(options.aeo);
        if (versions) config.corpus = { ...config.corpus, versions: {
          ...config.corpus?.versions, current: versions.current,
          order: config.corpus?.versions?.order ?? versions.archived.map((entry) => entry.version),
        } };
        const integration = aeo(config);
        declareContentRoutes(integration, ['/[...slug]']);
        addIntegration(integration);
        addIntegration({
          name: 'astro-aeo/starlight-options',
          hooks: {
            'astro:config:setup'({ updateConfig }) {
              updateConfig({
                vite: {
                  plugins: [{
                    name: 'astro-aeo:starlight-options',
                    resolveId: (/** @type {string} */ id) => (id === OPTIONS_MODULE ? RESOLVED_OPTIONS_MODULE : undefined),
                    load: (/** @type {string} */ id) =>
                      id === RESOLVED_OPTIONS_MODULE ? `export default ${JSON.stringify(runtime)};` : undefined,
                  }],
                },
              });
            },
          },
        });
        addRouteMiddleware({ entrypoint: 'astro-aeo/starlight/route-data', order: 'post' });
      },
    },
  };
}

/** @param {import('./starlight.js').StarlightAeoOptions} options */
function validateStarlightOptions(options) {
  const input = /** @type {any} */ (options);
  const fail = (/** @type {string} */ path, /** @type {string} */ reason) => {
    throw new AeoConfigError(`starlight.${path}: ${reason}`);
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('options', 'must be an object.');
  if (input.links !== undefined && (!input.links || typeof input.links !== 'object' || Array.isArray(input.links) ||
      Object.keys(input.links).some((key) => !['pagination', 'edit', 'source', 'versions'].includes(key)))) fail('links', 'must contain supported link options only.');
  for (const key of ['pagination', 'edit', 'versions']) {
    if (input.links?.[key] !== undefined && typeof input.links[key] !== 'boolean') fail(`links.${key}`, 'must be a boolean.');
  }
  if (input.techArticle !== undefined && typeof input.techArticle !== 'boolean') fail('techArticle', 'must be a boolean.');
  if (input.links?.source !== undefined) {
    const source = input.links.source;
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some((key) => key !== 'baseUrl')) {
      fail('links.source', 'must contain only baseUrl.');
    }
    try {
      const url = new URL(source.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error();
    } catch { fail('links.source.baseUrl', 'must be an HTTP(S) repository URL ending in / without credentials, query or fragment.'); }
  }
  if (input.versions === undefined) return undefined;
  const versions = input.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions) || Object.keys(versions).some((key) => !['current', 'archived'].includes(key))) {
    fail('versions', 'must contain current and archived.');
  }
  if (!isPageVersion(versions.current)) fail('versions.current', 'must be a safe version label.');
  if (!Array.isArray(versions.archived)) fail('versions.archived', 'must be an array.');
  const archived = versions.archived.map((/** @type {any} */ item, /** @type {number} */ index) => {
    const entry = typeof item === 'string' ? { version: item, prefix: item } : item;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((key) => !['version', 'prefix'].includes(key)) ||
        !isPageVersion(entry.version) || !isPageVersion(entry.prefix ?? entry.version)) fail(`versions.archived[${index}]`, 'must be a safe version label or { version, prefix }.');
    return { version: entry.version, prefix: entry.prefix ?? entry.version };
  });
  if (new Set([versions.current, ...archived.map((/** @type {any} */ entry) => entry.version)]).size !== archived.length + 1 ||
      new Set(archived.map((/** @type {any} */ entry) => entry.prefix)).size !== archived.length || archived.some((/** @type {any} */ entry) => entry.prefix === versions.current)) {
    fail('versions.archived', 'versions and prefixes must be unique and distinct from current.');
  }
  if (input.aeo?.corpus?.versions?.current !== undefined && input.aeo.corpus.versions.current !== versions.current) {
    fail('versions.current', 'conflicts with aeo.corpus.versions.current.');
  }
  return /** @type {{ current: string; archived: { version: string; prefix: string }[] }} */ ({ current: versions.current, archived });
}

/**
 * Starlight registers `@astrojs/sitemap` itself, renders content inside
 * `.sl-markdown-content`, and always emits a 404 page. The sitemap and selector
 * defaults yield to anything the project sets; the 404 exclusion is added to the
 * project's own list.
 *
 * @param {import('./index.js').AstroAeoConfig | undefined} config
 * @returns {import('./index.js').AstroAeoConfig}
 */
export function starlightDefaults(config = {}) {
  const input = /** @type {any} */ (config);
  const legacySitemap = input.sitemap !== undefined;
  return {
    ...input,
    // Starlight always renders a 404 page. It is not documentation.
    ...(input.exclude === undefined
      ? { pages: { ...input.pages, exclude: [...(input.pages?.exclude ?? []), '/404'] } }
      : {}),
    markdown: {
      ...input.markdown,
      extraction: {
        ...(input.markdown?.extraction?.selectors === undefined
          ? { selectors: ['.sl-markdown-content', 'main'] }
          : {}),
        ...input.markdown?.extraction,
      },
    },
    ...(legacySitemap
      ? {}
      : {
          discovery: {
            ...input.discovery,
            sitemap: { mode: 'external', ...input.discovery?.sitemap },
          },
        }),
  };
}

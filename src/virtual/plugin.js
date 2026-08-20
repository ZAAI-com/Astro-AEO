// @ts-check
import { toSource } from './serialize.js';

export const RUNTIME_CONFIG_ID = 'astro-aeo:runtime-config';
export const DYNAMIC_ROUTES_ID = 'astro-aeo:dynamic-routes';
export const DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL =
  'astro-aeo:development-dynamic-route-loader';
const RESOLVED_RUNTIME_CONFIG_ID = `\0${RUNTIME_CONFIG_ID}`;
const RESOLVED_DYNAMIC_ROUTES_ID = `\0${DYNAMIC_ROUTES_ID}`;

/**
 * @typedef {object} DynamicRouteDefinition
 * @property {string} entrypoint
 * @property {string} specifier
 * @property {string} pattern
 * @property {string[]} params
 * @property {Array<Array<{ content: string; dynamic: boolean; spread: boolean }>>} segments
 */

/**
 * @typedef {object} DynamicRouteModuleConfig
 * @property {'startup'|'hot'} mode
 * @property {DynamicRouteDefinition[]} routes
 * @property {string} [projectRoot]
 * @property {string} [pagesGlob]
 * @property {boolean} [warnOnDemand]
 */

/**
 * @param {() => Record<string, unknown>} getSnapshot
 * @param {() => { module: string; specifier: string }[]} [getCatalogModules]
 * @param {() => { pathname: string; path: string; specifier: string; kind?: 'markdown'|'mdx' }[]} [getMarkdownSources]
 * @param {() => { name: string; module: string; specifier: string; options?: import('../index.js').JsonValue; cache?: import('../index.js').CacheDeclaration }[]} [getMarkdownRenderers]
 * @param {() => { name: string; module: string; specifier: string; options?: import('../index.js').JsonValue; stages: string[]; claims: { id: string; pathname: string; replace?: boolean }[] }[]} [getRuntimePlugins]
 * @param {() => { name: string; version: string; approximate: boolean; module: string; specifier: string; options?: import('../index.js').JsonValue } | undefined} [getCorpusTokenizer]
 * @param {() => DynamicRouteModuleConfig | null} [getDynamicRoutes]
 * @returns {{ name: string; enforce: 'pre'; resolveId(id: string): string | undefined; load(id: string): string | undefined }}
 */
export function aeoRuntimeConfigPlugin(
  getSnapshot,
  getCatalogModules = () => [],
  getMarkdownSources = () => [],
  getMarkdownRenderers = () => [],
  getRuntimePlugins = () => [],
  getCorpusTokenizer = () => undefined,
  getDynamicRoutes = () => null,
) {
  return {
    name: 'astro-aeo:runtime-config',
    enforce: 'pre',
    /** @param {string} id */
    resolveId(id) {
      if (id === RUNTIME_CONFIG_ID) return RESOLVED_RUNTIME_CONFIG_ID;
      if (id === DYNAMIC_ROUTES_ID) return RESOLVED_DYNAMIC_ROUTES_ID;
      return undefined;
    },
    /** @param {string} id */
    load(id) {
      if (id === RESOLVED_DYNAMIC_ROUTES_ID) {
        return dynamicRoutesModuleSource(getDynamicRoutes());
      }
      if (id !== RESOLVED_RUNTIME_CONFIG_ID) return undefined;
      const catalogLoaders = getCatalogModules()
        .map(
          ({ module, specifier }) =>
            `{ module: ${JSON.stringify(module)}, load: () => import(${JSON.stringify(specifier)}).then((namespace) => namespace.default ?? namespace) }`,
        )
        .join(', ');
      const markdownRendererLoaders = getMarkdownRenderers()
        .map(
          ({ name, module, specifier, options, cache }) =>
            `{ name: ${JSON.stringify(name)}, module: ${JSON.stringify(module)}, ` +
            `${options === undefined ? '' : `options: ${toSource(options)}, `}` +
            `${cache === undefined ? '' : `cache: ${toSource(cache)}, `}` +
            `load: () => import(${JSON.stringify(specifier)}).then((namespace) => namespace.default) }`,
        )
        .join(', ');
      const runtimePluginLoaders = getRuntimePlugins()
        .map(
          ({ name, module, specifier, options, stages, claims }) =>
            `{ name: ${JSON.stringify(name)}, module: ${JSON.stringify(module)}, ` +
            `${options === undefined ? '' : `options: ${toSource(options)}, `}` +
            `stages: ${toSource(stages)}, claims: ${toSource(claims)}, ` +
            `load: () => import(${JSON.stringify(specifier)}).then((namespace) => namespace.default ?? namespace) }`,
        )
        .join(', ');
      const tokenizer = getCorpusTokenizer();
      const corpusTokenizerLoader = tokenizer
        ? `{ name: ${JSON.stringify(tokenizer.name)}, version: ${JSON.stringify(tokenizer.version)}, ` +
          `approximate: ${JSON.stringify(tokenizer.approximate)}, module: ${JSON.stringify(tokenizer.module)}, ` +
          `${tokenizer.options === undefined ? '' : `options: ${toSource(tokenizer.options)}, `}` +
          `load: () => import(${JSON.stringify(tokenizer.specifier)}).then((namespace) => namespace.default) }`
        : 'undefined';
      const sources = getMarkdownSources();
      const dynamicRoutes = getDynamicRoutes();
      const dynamicRouteSource = dynamicRoutes
        ? `{ mode: ${JSON.stringify(dynamicRoutes.mode)}, load: () => import(${JSON.stringify(DYNAMIC_ROUTES_ID)}) }`
        : 'null';
      const sourceImports = sources
        .map(
          ({ specifier }, index) =>
            `import __astroAeoMarkdown${index} from ${JSON.stringify(`${specifier}?raw`)};`,
        )
        .join('\n');
      const sourceRegistry = sources
        .map(
          ({ pathname, path, kind = 'markdown' }, index) =>
            `${JSON.stringify(pathname)}: { kind: ${JSON.stringify(kind)}, body: __astroAeoStripFrontmatter(__astroAeoMarkdown${index}), ` +
            `${kind === 'markdown' ? `markdown: __astroAeoStripFrontmatter(__astroAeoMarkdown${index}), ` : ''}` +
            `path: ${JSON.stringify(path)} }`,
        )
        .join(', ');
      const imports = [sourceImports].filter(Boolean).join('\n');
      return (
        `${imports}${imports ? '\n' : ''}` +
        `export const CATALOG_LOADERS = [${catalogLoaders}];\n` +
        `export const MARKDOWN_RENDERER_LOADERS = [${markdownRendererLoaders}];\n` +
        `export const RUNTIME_PLUGIN_LOADERS = [${runtimePluginLoaders}];\n` +
        `export const CORPUS_TOKENIZER_LOADER = ${corpusTokenizerLoader};\n` +
        `export const DYNAMIC_ROUTE_SOURCE = ${dynamicRouteSource};\n` +
        `const __astroAeoStripFrontmatter = (markdown) => markdown.startsWith('---') ? markdown.replace(/^---[\\t ]*\\r?\\n[\\s\\S]*?\\r?\\n---[\\t ]*(?:\\r?\\n|$)/, '') : markdown;\n` +
        `export const RUNTIME = ${toSource(getSnapshot())};\n` +
        `RUNTIME.standaloneSources = { ${sourceRegistry} };\n` +
        `export default RUNTIME;\n`
      );
    },
  };
}

/**
 * @param {DynamicRouteModuleConfig | null} config
 * @returns {string}
 */
function dynamicRoutesModuleSource(config) {
  if (!config) return 'export const list = () => [];\n';
  if (config.mode === 'startup') {
    const routes = config.routes.map((route) =>
      `{ entrypoint: ${JSON.stringify(route.entrypoint)}, pattern: ${JSON.stringify(route.pattern)}, ` +
      `params: ${toSource(route.params)}, segments: ${toSource(route.segments)}, ` +
      `load: () => import(${JSON.stringify(route.specifier)}) }`
    ).join(', ');
    return markDevelopmentDynamicRouteLoader(`const list = () => [${routes}];\n`);
  }

  const pagesGlob = config.pagesGlob;
  const projectRoot = config.projectRoot;
  if (!pagesGlob || !pagesGlob.startsWith('/') || !projectRoot) {
    return markDevelopmentDynamicRouteLoader(
      `export const list = () => { ` +
      `throw new Error("astro-aeo-hot-routes-unavailable"); ` +
      `};\n`,
    );
  }
  return hotDynamicRoutesModuleSource(projectRoot, pagesGlob, config.warnOnDemand === true);
}

/**
 * @param {string} projectRoot
 * @param {string} pagesGlob
 * @param {boolean} warnOnDemand
 * @returns {string}
 */
function hotDynamicRoutesModuleSource(projectRoot, pagesGlob, warnOnDemand) {
  return markDevelopmentDynamicRouteLoader(
    `const __astroAeoLoadRoutes = async () => {\n` +
    `  try {\n` +
    `    const value = await import("virtual:astro:routes");\n` +
    `    return value.routes;\n` +
    `  } catch {\n` +
    `    throw new Error("astro-aeo-hot-routes-unavailable");\n` +
    `  }\n` +
    `};\n` +
    `const __astroAeoFreshModules = import.meta.glob(${JSON.stringify(pagesGlob)}, { exhaustive: true });\n` +
    `const __astroAeoRoot = ${JSON.stringify(normalizeFsPath(projectRoot))};\n` +
    `const __astroAeoFail = () => { throw new Error("astro-aeo-hot-routes-unavailable"); };\n` +
    `let __astroAeoWarnedOnDemand = false;\n` +
    `if (import.meta.hot) {\n` +
    `  import.meta.hot.data.astroAeoModules = __astroAeoFreshModules;\n` +
    `  import.meta.hot.accept();\n` +
    `}\n` +
    `const __astroAeoWarnOnDemand = () => {\n` +
    `  if (!${JSON.stringify(warnOnDemand)}) return;\n` +
    `  const state = import.meta.hot?.data;\n` +
    `  if (state?.astroAeoWarnedOnDemand || __astroAeoWarnedOnDemand) return;\n` +
    `  if (state) state.astroAeoWarnedOnDemand = true;\n` +
    `  else __astroAeoWarnedOnDemand = true;\n` +
    `  console.warn("astro-aeo: on-demand dynamic page routes require pages.catalogs for development corpus enumeration.");\n` +
    `};\n` +
    `const __astroAeoEntrypointKey = (value) => {\n` +
    `  if (typeof value !== "string" || value.length === 0) return null;\n` +
    `  let key = value.replace(/\\\\/g, "/").replace(/[?#].*$/, "");\n` +
    `  if (key.startsWith("file://")) {\n` +
    `    try { key = decodeURIComponent(new URL(key).pathname); } catch { return null; }\n` +
    `  }\n` +
    `  if (key === __astroAeoRoot) key = "/";\n` +
    `  else if (key.startsWith(__astroAeoRoot + "/")) key = key.slice(__astroAeoRoot.length);\n` +
    `  if (!key.startsWith("/")) key = "/" + key;\n` +
    `  return key.replace(/\\/{2,}/g, "/");\n` +
    `};\n` +
    `const list = async () => {\n` +
    `  const __astroAeoRoutes = await __astroAeoLoadRoutes();\n` +
    `  if (!Array.isArray(__astroAeoRoutes)) return __astroAeoFail();\n` +
    `  const __astroAeoModules = import.meta.hot?.data.astroAeoModules ?? __astroAeoFreshModules;\n` +
    `  const loaders = [];\n` +
    `  for (const value of __astroAeoRoutes) {\n` +
    `    if (!value || typeof value !== "object" || Array.isArray(value)) return __astroAeoFail();\n` +
    `    const wrapped = Object.hasOwn(value, "routeData");\n` +
    `    const route = wrapped ? value.routeData : value;\n` +
    `    if (!route || typeof route !== "object" || Array.isArray(route)) return __astroAeoFail();\n` +
    `    const origin = route.origin;\n` +
    `    const type = route.type;\n` +
    `    const pathname = route.pathname;\n` +
    `    if (!["page", "endpoint", "redirect", "fallback"].includes(type)) return __astroAeoFail();\n` +
    `    if ((origin !== undefined && typeof origin !== "string") || (pathname != null && typeof pathname !== "string")) return __astroAeoFail();\n` +
    `    if ((origin !== undefined && origin !== "project") || type !== "page" || pathname != null) continue;\n` +
    `    const prerendered = route.isPrerendered ?? route.prerender;\n` +
    `    if (typeof prerendered !== "boolean") return __astroAeoFail();\n` +
    `    if (!prerendered) { __astroAeoWarnOnDemand(); continue; }\n` +
    `    const sourceEntrypoint = route.entrypoint ?? route.component;\n` +
    `    const entrypoint = __astroAeoEntrypointKey(sourceEntrypoint);\n` +
    `    const pattern = typeof route.pattern === "string" ? route.pattern : route.route;\n` +
    `    const load = entrypoint ? __astroAeoModules[entrypoint] : undefined;\n` +
    `    if (!entrypoint || typeof pattern !== "string" || !Array.isArray(route.params) || !Array.isArray(route.segments) || typeof load !== "function") return __astroAeoFail();\n` +
    `    loaders.push({ entrypoint, pattern, params: route.params, segments: route.segments, load });\n` +
    `  }\n` +
    `  return loaders;\n` +
    `};\n`,
  );
}

/**
 * Attach a semantic marker to the exported loader. Unlike a comment or an
 * unused constant, this remains in a bundle whenever the loader module is
 * reachable, giving production bundle gates one stable startup/hot sentinel.
 *
 * @param {string} source
 * @returns {string}
 */
function markDevelopmentDynamicRouteLoader(source) {
  const declaration = source.replace('export const list', 'const list');
  return (
    declaration +
    `Object.defineProperty(list, ${JSON.stringify(DEVELOPMENT_DYNAMIC_ROUTE_LOADER_SENTINEL)}, { value: true });\n` +
    `export { list };\n`
  );
}

/** @param {string} value */
function normalizeFsPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
}

// @ts-check
import { toSource } from './serialize.js';

export const RUNTIME_CONFIG_ID = 'astro-aeo:runtime-config';
const RESOLVED_ID = `\0${RUNTIME_CONFIG_ID}`;

/**
 * @param {() => Record<string, unknown>} getSnapshot
 * @param {() => { module: string; specifier: string }[]} [getCatalogModules]
 * @param {() => { pathname: string; path: string; specifier: string; kind?: 'markdown'|'mdx' }[]} [getMarkdownSources]
 * @param {() => { name: string; module: string; specifier: string; options?: import('../index.js').JsonValue; cache?: import('../index.js').CacheDeclaration }[]} [getMarkdownRenderers]
 * @param {() => { name: string; module: string; specifier: string; options?: import('../index.js').JsonValue; stages: string[]; claims: { id: string; pathname: string; replace?: boolean }[] }[]} [getRuntimePlugins]
 * @param {() => { name: string; version: string; approximate: boolean; module: string; specifier: string; options?: import('../index.js').JsonValue } | undefined} [getCorpusTokenizer]
 * @returns {{ name: string; enforce: 'pre'; resolveId(id: string): string | undefined; load(id: string): string | undefined }}
 */
export function aeoRuntimeConfigPlugin(
  getSnapshot,
  getCatalogModules = () => [],
  getMarkdownSources = () => [],
  getMarkdownRenderers = () => [],
  getRuntimePlugins = () => [],
  getCorpusTokenizer = () => undefined,
) {
  return {
    name: 'astro-aeo:runtime-config',
    enforce: 'pre',
    /** @param {string} id */
    resolveId(id) {
      return id === RUNTIME_CONFIG_ID ? RESOLVED_ID : undefined;
    },
    /** @param {string} id */
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
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
        `const __astroAeoStripFrontmatter = (markdown) => markdown.startsWith('---') ? markdown.replace(/^---[\\t ]*\\r?\\n[\\s\\S]*?\\r?\\n---[\\t ]*(?:\\r?\\n|$)/, '') : markdown;\n` +
        `export const RUNTIME = ${toSource(getSnapshot())};\n` +
        `RUNTIME.standaloneSources = { ${sourceRegistry} };\n` +
        `export default RUNTIME;\n`
      );
    },
  };
}

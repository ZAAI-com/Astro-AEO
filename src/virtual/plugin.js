// @ts-check
import { toSource } from './serialize.js';

export const RUNTIME_CONFIG_ID = 'astro-aeo:runtime-config';
const RESOLVED_ID = `\0${RUNTIME_CONFIG_ID}`;

/**
 * @param {() => Record<string, unknown>} getSnapshot
 * @param {() => { module: string; specifier: string }[]} [getCatalogModules]
 * @param {() => { pathname: string; path: string; specifier: string }[]} [getMarkdownSources]
 * @returns {{ name: string; enforce: 'pre'; resolveId(id: string): string | undefined; load(id: string): string | undefined }}
 */
export function aeoRuntimeConfigPlugin(
  getSnapshot,
  getCatalogModules = () => [],
  getMarkdownSources = () => [],
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
      const sources = getMarkdownSources();
      const sourceImports = sources
        .map(
          ({ specifier }, index) =>
            `import __astroAeoMarkdown${index} from ${JSON.stringify(`${specifier}?raw`)};`,
        )
        .join('\n');
      const sourceRegistry = sources
        .map(
          ({ pathname, path }, index) =>
            `${JSON.stringify(pathname)}: { markdown: __astroAeoStripFrontmatter(__astroAeoMarkdown${index}), path: ${JSON.stringify(path)} }`,
        )
        .join(', ');
      const imports = [sourceImports].filter(Boolean).join('\n');
      return (
        `${imports}${imports ? '\n' : ''}` +
        `export const CATALOG_LOADERS = [${catalogLoaders}];\n` +
        `const __astroAeoStripFrontmatter = (markdown) => markdown.startsWith('---') ? markdown.replace(/^---[\\t ]*\\r?\\n[\\s\\S]*?\\r?\\n---[\\t ]*(?:\\r?\\n|$)/, '') : markdown;\n` +
        `export const RUNTIME = ${toSource(getSnapshot())};\n` +
        `RUNTIME.standaloneSources = { ${sourceRegistry} };\n` +
        `export default RUNTIME;\n`
      );
    },
  };
}

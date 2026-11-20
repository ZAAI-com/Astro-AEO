import { describe, expect, test } from 'vitest';
import {
  auditRuleIds,
  cliCommands,
  collectSurfaces,
  compareSurfaces,
  declarationNames,
  renderMarkdown,
  schemaPaths,
} from './compatibility-report.mjs';

/** @param {Record<string, string>} files */
function tree(files) {
  return { read: (/** @type {string} */ path) => files[path] ?? null, files: Object.keys(files) };
}

const BASE = tree({
  'package.json': JSON.stringify({
    exports: { '.': './src/index.js', './page': './src/page.js' },
    dependencies: { turndown: '1' },
    peerDependencies: { astro: '>=5.0.0' },
    engines: { node: '>=20.19.5' },
  }),
  'src/index.d.ts': 'export interface Kept {}\nexport interface Dropped {}\nexport default function aeo(): void;\n',
  'src/page.d.ts': 'export type CatalogPage = PageDescriptor;\nexport { a as b, type C } from "./x";\n',
  'schema/astro-aeo.schema.json': JSON.stringify({ properties: { pages: { properties: { exclude: {} } }, dotmd: { properties: { enabled: {} } } } }),
  'bin/astro-aeo.js': 'const HELP = `x\n\nUsage:\n  astro-aeo validate [distDir]  V\n  astro-aeo indexnow prepare [d]  P\n  astro-aeo --help  H\n\nOptions`;',
  'src/audit/rules.js': "...rules('metadata', 'error', ['build'], [\n  'aeo-head-invalid', 'aeo-head-multiple',\n]),",
  'src/build/write.js': "writer.write({ owner: 'llmsTxt' });",
});

describe('surface collection', () => {
  test('reads every published surface from a tree', () => {
    const surfaces = collectSurfaces(BASE.read, BASE.files);
    expect(surfaces.exports.list).toEqual(['.', './page']);
    expect(surfaces.engines.values).toEqual({ node: '>=20.19.5' });
    expect(surfaces.declarations.list).toEqual([
      'src/index.d.ts#Dropped', 'src/index.d.ts#Kept', 'src/index.d.ts#default',
      'src/page.d.ts#C', 'src/page.d.ts#CatalogPage', 'src/page.d.ts#b',
    ]);
    expect(surfaces.schema.list).toEqual(['dotmd', 'dotmd.enabled', 'pages', 'pages.exclude']);
    expect(surfaces.cli.list).toEqual(['indexnow prepare', 'validate']);
    expect(surfaces.auditRules.list).toEqual(['aeo-head-invalid', 'aeo-head-multiple']);
    expect(surfaces.artifactOwners.list).toEqual(['llmsTxt']);
  });

  test('parses the declaration, schema, CLI and rule shapes it relies on', () => {
    expect(declarationNames('export declare const x: 1;\nexport * from "./y";')).toEqual(['x', '* from ./y']);
    expect(schemaPaths({ properties: { a: { properties: { b: {} } } } })).toEqual(['a', 'a.b']);
    expect(cliCommands('Usage:\n  astro-aeo report traffic|changes [input]\n\n')).toEqual(['report']);
    expect(auditRuleIds("rules('a', 'warning', [], ['x'])")).toEqual(['x']);
  });
});

describe('comparison', () => {
  const current = tree({
    ...Object.fromEntries(BASE.files.map((file) => [file, BASE.read(file)])),
    'package.json': JSON.stringify({
      exports: { '.': './src/index.js', './page': './src/page.js', './new': './src/new.js' },
      dependencies: { turndown: '1' },
      peerDependencies: { astro: '>=6.0.0' },
      engines: { node: '>=22.12.0' },
    }),
    'src/index.d.ts': 'export interface Kept {}\nexport default function aeo(): void;\n',
    'src/page.d.ts': 'export { a as b, type C } from "./x";\n',
    'schema/astro-aeo.schema.json': JSON.stringify({ properties: { pages: { properties: { exclude: {} } } } }),
  });
  const diff = (/** @type {any} */ expected) => compareSurfaces(
    collectSurfaces(BASE.read, BASE.files),
    collectSurfaces(current.read, current.files),
    expected,
  );

  test('lists removals, additions and changes', () => {
    const result = diff({});
    expect(result.declarations.removed).toEqual(['src/index.d.ts#Dropped', 'src/page.d.ts#CatalogPage']);
    expect(result.exports.added).toEqual(['./new']);
    expect(result.peerDependencies.changed).toEqual(['astro: >=5.0.0 -> >=6.0.0']);
    expect(result.schema.removed).toEqual(['dotmd', 'dotmd.enabled']);
  });

  test('fails every removal or change that is not expected', () => {
    const result = diff({});
    expect(result.declarations.unexpected).toEqual(['removed src/index.d.ts#Dropped', 'removed src/page.d.ts#CatalogPage']);
    expect(result.engines.unexpected).toEqual(['changed node: >=20.19.5 -> >=22.12.0']);
    expect(result.exports.unexpected).toEqual([]);
  });

  test('accepts exact and prefix allowlist entries', () => {
    const result = diff({
      removals: { declarations: ['src/index.d.ts#Dropped', 'src/page.d.ts#CatalogPage'], schema: ['dotmd', 'dotmd.*'] },
      changes: { peerDependencies: ['astro: >=5.0.0 -> >=6.0.0'], engines: ['node: >=20.19.5 -> >=22.12.0'] },
    });
    expect(Object.values(result).flatMap((entry) => entry.unexpected)).toEqual([]);
  });

  test('renders not-run sections as not run', () => {
    const markdown = renderMarkdown({
      version: '2.0.0', base: '1.6.1', head: 'abc1234',
      surfaces: { exports: { before: 2, after: 3, removed: [], added: ['./new'], changed: [], unexpected: [] } },
      parity: null, gates: null, sizes: null, toolchain: { node: '24' },
    });
    expect(markdown).toContain('| exports | 2 | 3 | 0 | 1 | 0 | 0 |');
    expect(markdown).toContain('Not run. Pass `--run-parity`');
    expect(markdown).toContain('Not run. `release:check`');
    expect(markdown).toContain('Not measured.');
  });
});

#!/usr/bin/env node
// Compares the published surface of the working tree with a released tag and writes
// the release's compatibility report. Every removal must be listed in
// EXPECTED_REMOVALS; any other removal or change fails, so a major release cannot
// drop a public name by accident. Not shipped: `scripts/` is outside the package.
//
//   node scripts/compatibility-report.mjs [--base 1.6.1] [--check] [--run-parity] [--sizes]
//
// --check        compare and exit non-zero on an unexpected difference; write nothing
// --run-parity   run the byte-parity e2e tests and record their result
// --sizes        pack the working tree and read the base release's size from npm
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECLARATION_ROOTS = ['src', 'components'];

/**
 * The removals 2.0.0 makes on purpose. Keys are surface names; values are exact
 * entries or `prefix*` patterns.
 * @type {Record<string, string[]>}
 */
export const EXPECTED_REMOVALS = {
  declarations: [
    'src/index.d.ts#DotmdOptions',
    'src/index.d.ts#LlmsTxtOptions',
    'src/index.d.ts#LlmsFullTxtOptions',
    'src/index.d.ts#UrlMapOptions',
    'src/index.d.ts#RobotsTxtOptions',
    'src/index.d.ts#SitemapOptions',
    'src/index.d.ts#SitemapAliasOptions',
    'src/index.d.ts#DomainProfileOptions',
    'src/index.d.ts#LegacyAeoConfig',
    'src/index.d.ts#ResolvedAeoConfig',
    'src/page.d.ts#CatalogPage',
  ],
  schema: [
    'include', 'exclude', 'respectNoindex', 'stripTitleSuffix',
    'dotmd', 'dotmd.*', 'llmsTxt', 'llmsTxt.*', 'llmsFullTxt', 'llmsFullTxt.*', 'urlMap', 'urlMap.*',
    'sitemap', 'sitemap.*', 'sitemapAlias', 'sitemapAlias.*', 'robotsTxt', 'robotsTxt.*',
    'domainProfile', 'domainProfile.*',
  ],
};

/** Values that 2.0.0 changes on purpose, as `name: from -> to`. */
export const EXPECTED_CHANGES = {
  peerDependencies: ['astro: >=5.0.0 -> >=6.0.0'],
  engines: ['node: >=20.19.5 -> >=22.12.0'],
};

/**
 * @typedef {(path: string) => string | null} ReadText
 * @typedef {{ list: string[]; values: Record<string, string> }} Surface
 * @typedef {Record<string, Surface>} Surfaces
 */

/**
 * @param {ReadText} read
 * @param {string[]} files  Repository-relative paths of the tree being described.
 * @returns {Surfaces}
 */
export function collectSurfaces(read, files) {
  const pkg = JSON.parse(read('package.json') ?? '{}');
  const declarations = files
    .filter((file) => file.endsWith('.d.ts') && DECLARATION_ROOTS.some((root) => file.startsWith(`${root}/`)))
    .sort()
    .flatMap((file) => declarationNames(read(file) ?? '').map((name) => `${file}#${name}`));
  const schemaText = read('schema/astro-aeo.schema.json');
  return {
    exports: listSurface(Object.keys(pkg.exports ?? {})),
    dependencies: listSurface(Object.keys(pkg.dependencies ?? {})),
    peerDependencies: valueSurface(pkg.peerDependencies ?? {}),
    engines: valueSurface(pkg.engines ?? {}),
    declarations: listSurface(declarations),
    schema: listSurface(schemaText ? schemaPaths(JSON.parse(schemaText)) : []),
    cli: listSurface(cliCommands(read('bin/astro-aeo.js') ?? '')),
    auditRules: listSurface(auditRuleIds(read('src/audit/rules.js') ?? '')),
    artifactOwners: listSurface(
      files
        .filter((file) => file.startsWith('src/') && file.endsWith('.js') && !file.endsWith('.test.js'))
        .flatMap((file) => [...(read(file) ?? '').matchAll(/owner: '([A-Za-z][\w:-]*)'/g)].map((match) => match[1])),
    ),
  };
}

/** @param {string[]} values @returns {Surface} */
function listSurface(values) {
  return { list: [...new Set(values)].sort(), values: {} };
}

/** @param {Record<string, unknown>} record @returns {Surface} */
function valueSurface(record) {
  return {
    list: Object.keys(record).sort(),
    values: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)])),
  };
}

/** @param {string} text @returns {string[]} */
export function declarationNames(text) {
  const names = [];
  for (const match of text.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|function|const|let|var|class|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm,
  )) names.push(match[1]);
  if (/^export\s+default\b/m.test(text)) names.push('default');
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  for (const match of text.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) names.push(`* from ${match[1]}`);
  return names;
}

/** @param {any} schema @param {string} [prefix] @returns {string[]} */
export function schemaPaths(schema, prefix = '') {
  if (!schema || typeof schema !== 'object' || !schema.properties) return [];
  return Object.entries(schema.properties).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...schemaPaths(child, path)];
  });
}

/** @param {string} text @returns {string[]} */
export function cliCommands(text) {
  const usage = text.slice(text.indexOf('Usage:'), text.indexOf('\n\n', text.indexOf('Usage:')));
  const commands = [];
  for (const line of usage.split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] !== 'astro-aeo') continue;
    const command = [];
    for (const word of words.slice(1)) {
      if (!/^[a-z][a-z-]*$/.test(word)) break;
      command.push(word);
    }
    if (command.length) commands.push(command.join(' '));
  }
  return commands;
}

/** @param {string} text @returns {string[]} */
export function auditRuleIds(text) {
  const ids = [];
  for (const match of text.matchAll(/rules\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\[[^\]]*\]\s*,\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const id of match[1].matchAll(/'([^']+)'/g)) ids.push(id[1]);
  }
  return ids;
}

/**
 * @param {Surfaces} base @param {Surfaces} current
 * @param {{ removals?: Record<string, string[]>; changes?: Record<string, string[]> }} [expected]
 */
export function compareSurfaces(base, current, expected = { removals: EXPECTED_REMOVALS, changes: EXPECTED_CHANGES }) {
  const surfaces = [...new Set([...Object.keys(base), ...Object.keys(current)])].sort();
  /** @type {Record<string, { removed: string[]; added: string[]; changed: string[]; unexpected: string[] }>} */
  const result = {};
  for (const name of surfaces) {
    const before = base[name] ?? { list: [], values: {} };
    const after = current[name] ?? { list: [], values: {} };
    const afterSet = new Set(after.list);
    const beforeSet = new Set(before.list);
    const removed = before.list.filter((entry) => !afterSet.has(entry));
    const added = after.list.filter((entry) => !beforeSet.has(entry));
    const changed = before.list
      .filter((entry) => afterSet.has(entry) && before.values[entry] !== after.values[entry])
      .map((entry) => `${entry}: ${before.values[entry]} -> ${after.values[entry]}`);
    const allowedRemovals = expected.removals?.[name] ?? [];
    const allowedChanges = new Set(expected.changes?.[name] ?? []);
    const unexpected = [
      ...removed.filter((entry) => !allowedRemovals.some((pattern) => matches(pattern, entry))).map((entry) => `removed ${entry}`),
      ...changed.filter((entry) => !allowedChanges.has(entry)).map((entry) => `changed ${entry}`),
    ];
    result[name] = { removed, added, changed, unexpected };
  }
  return result;
}

/** @param {string} pattern @param {string} entry */
function matches(pattern, entry) {
  return pattern.endsWith('*') ? entry.startsWith(pattern.slice(0, -1)) : pattern === entry;
}

/** @param {string} ref @returns {{ read: ReadText; files: string[] }} */
function gitTree(ref) {
  const listed = git(['ls-tree', '-r', '--name-only', ref]);
  return {
    files: listed.split('\n').filter(Boolean),
    read: (path) => {
      const result = spawnSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return result.status === 0 ? result.stdout : null;
    },
  };
}

/** @returns {{ read: ReadText; files: string[] }} */
function workingTree() {
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [relative(ROOT, full).split(sep).join('/')];
  });
  return {
    files: ['src', 'components', 'bin', 'cli', 'schema'].flatMap((dir) => walk(join(ROOT, dir))),
    read: (path) => {
      try {
        return readFileSync(join(ROOT, path), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

/** @param {string[]} args */
function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** @param {string} command @param {string[]} args */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const PARITY_TESTS = ['src/golden-output.e2e.test.js', 'src/config-compat.e2e.test.js'];
const DEFAULT_SUITE_STEP = 'Unit, CLI, and static build tests';

function installedAstro() {
  return JSON.parse(readFileSync(join(ROOT, 'node_modules/astro/package.json'), 'utf8')).version;
}

function runParity() {
  const run = capture(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...PARITY_TESTS]);
  return PARITY_TESTS.map((test) => ({ test, status: run.ok ? 'passed' : 'failed', astro: installedAstro() }));
}

/** The default suite includes both parity tests, so a passed release:check step covers them.
 * @param {{ name: string; status: string }[] | null} gates */
function parityFromGates(gates) {
  const step = gates?.find((entry) => entry.name === DEFAULT_SUITE_STEP);
  if (!step) return null;
  return PARITY_TESTS.map((test) => ({ test, status: `${step.status} (release:check default suite)`, astro: installedAstro() }));
}

/** @param {string} base */
function measureSizes(base) {
  const current = capture('npm', ['pack', '--dry-run', '--json']);
  const released = capture('npm', ['view', `astro-aeo@${base}`, 'dist', '--json']);
  /** @param {string} text */
  const parse = (text) => {
    try {
      return JSON.parse(text.slice(Math.min(...['[', '{'].map((c) => text.indexOf(c)).filter((i) => i >= 0))));
    } catch {
      return null;
    }
  };
  const packed = current.ok ? parse(current.stdout)?.[0] : null;
  const dist = released.ok ? parse(released.stdout) : null;
  return {
    current: packed ? { packed: packed.size, unpacked: packed.unpackedSize, files: packed.entryCount } : null,
    base: dist?.unpackedSize ? { unpacked: dist.unpackedSize, files: dist.fileCount } : null,
  };
}

/** @param {string | undefined} raw */
function releaseSteps(raw) {
  if (!raw) return null;
  try {
    return /** @type {{ name: string; status: string }[]} */ (JSON.parse(raw));
  } catch {
    return null;
  }
}

function toolchain() {
  const version = (/** @type {string} */ pkg) => {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;
    } catch {
      return 'not installed';
    }
  };
  return {
    node: process.versions.node,
    pnpm: capture('pnpm', ['--version']).stdout.trim() || 'unknown',
    astro: version('astro'),
    typescript: version('typescript'),
    vitest: version('vitest'),
  };
}

/** @param {any} report @returns {string} */
export function renderMarkdown(report) {
  const lines = [
    `# ${report.version} compatibility report`,
    '',
    `Generated by \`node scripts/compatibility-report.mjs\`. Compares the working tree at`,
    `\`${report.head}\` with the published \`${report.base}\` tag. Do not edit by hand.`,
    '',
    '## Surface diff',
    '',
    '| Surface | Before | After | Removed | Added | Changed | Unexpected |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [name, diff] of Object.entries(report.surfaces)) {
    lines.push(`| ${name} | ${diff.before} | ${diff.after} | ${diff.removed.length} | ${diff.added.length} | ${diff.changed.length} | ${diff.unexpected.length} |`);
  }
  lines.push('');
  for (const [name, diff] of Object.entries(report.surfaces)) {
    if (!diff.removed.length && !diff.added.length && !diff.changed.length) continue;
    lines.push(`### ${name}`, '');
    for (const [label, entries] of [['Removed', diff.removed], ['Added', diff.added], ['Changed', diff.changed], ['Unexpected', diff.unexpected]]) {
      if (!entries.length) continue;
      lines.push(`${label}:`, '', ...entries.map((/** @type {string} */ entry) => `- \`${entry}\``), '');
    }
  }
  lines.push(
    'Member-level declaration changes are not detected by this diff. 2.0.0 removes one:',
    '`AeoHeadProps.author` (use `authors`). See CHANGELOG.md.',
    '',
    '## Byte parity',
    '',
  );
  if (report.parity) {
    lines.push('| Test | Status | Astro |', '| --- | --- | --- |');
    for (const entry of report.parity) lines.push(`| \`${entry.test}\` | ${entry.status} | ${entry.astro} |`);
  } else {
    lines.push('Not run. Pass `--run-parity` to run the golden-1.0 and 1.6 byte-parity tests.');
  }
  lines.push('', '## Release gates', '');
  if (report.gates) {
    lines.push('| Step | Status |', '| --- | --- |');
    for (const step of report.gates) lines.push(`| ${step.name} | ${step.status} |`);
    lines.push('', 'Steps after this report in the same run are not listed; a failure there stops the run.');
  } else {
    lines.push('Not run. `release:check` passes its step results to this report when it runs it.');
  }
  lines.push('', '## Package size', '');
  if (report.sizes) {
    const { current, base } = report.sizes;
    lines.push('| Release | Packed bytes | Unpacked bytes | Files |', '| --- | --- | --- | --- |');
    lines.push(`| \`${report.base}\` (npm) | ${base ? 'not reported by npm' : 'not measured'} | ${base?.unpacked ?? 'not measured'} | ${base?.files ?? 'not measured'} |`);
    lines.push(`| \`${report.version}\` (working tree) | ${current?.packed ?? 'not measured'} | ${current?.unpacked ?? 'not measured'} | ${current?.files ?? 'not measured'} |`);
  } else {
    lines.push('Not measured. Pass `--sizes`.');
  }
  lines.push('', '## Toolchain', '', ...Object.entries(report.toolchain).map(([name, value]) => `- ${name}: ${value}`), '');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args[baseIndex + 1] : '1.6.1';
  if (!base) throw new Error('--base requires a tag.');
  const check = args.includes('--check');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const before = gitTree(base);
  const after = workingTree();
  const baseSurfaces = collectSurfaces(before.read, before.files);
  const currentSurfaces = collectSurfaces(after.read, after.files);
  const diff = compareSurfaces(baseSurfaces, currentSurfaces);
  const unexpected = Object.entries(diff).flatMap(([name, entry]) => entry.unexpected.map((line) => `${name}: ${line}`));

  if (check) {
    if (unexpected.length) {
      console.error(`Compatibility report: unexpected differences from ${base}:`);
      for (const line of unexpected) console.error(`  ${line}`);
      process.exitCode = 1;
    } else {
      const removed = Object.values(diff).reduce((sum, entry) => sum + entry.removed.length, 0);
      console.log(`Compatibility report: ${removed} removal(s) from ${base}, all expected.`);
    }
    return;
  }

  const report = {
    version: pkg.version,
    base,
    head: git(['rev-parse', '--short', 'HEAD']).trim() + (git(['status', '--porcelain']).trim() ? ' (with uncommitted changes)' : ''),
    surfaces: Object.fromEntries(Object.entries(diff).map(([name, entry]) => [name, {
      before: baseSurfaces[name]?.list.length ?? 0,
      after: currentSurfaces[name]?.list.length ?? 0,
      ...entry,
    }])),
    parity: args.includes('--run-parity') ? runParity() : parityFromGates(releaseSteps(process.env.ASTRO_AEO_RELEASE_STEPS)),
    gates: releaseSteps(process.env.ASTRO_AEO_RELEASE_STEPS),
    sizes: args.includes('--sizes') ? measureSizes(base) : null,
    toolchain: toolchain(),
  };
  const stem = join(ROOT, 'docs', 'release-evidence', `${pkg.version}-compatibility-report`);
  writeFileSync(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${stem}.md`, renderMarkdown(report));
  console.log(`Wrote ${relative(ROOT, stem)}.md and .json.`);
  if (unexpected.length) {
    console.error(`Unexpected differences from ${base}:`);
    for (const line of unexpected) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

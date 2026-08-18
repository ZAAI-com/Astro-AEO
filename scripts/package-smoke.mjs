#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { RELEASE_THRESHOLDS } from '../benchmarks/thresholds.mjs';

const PACKED_LIMIT = RELEASE_THRESHOLDS.packagePackedBytes;
const UNPACKED_LIMIT = RELEASE_THRESHOLDS.packageUnpackedBytes;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspectOnly = process.argv.includes('--inspect-only');
const allowSizeOverage = process.argv.includes('--allow-size-overage');
const keepTemporary = process.env.AEO_KEEP_PACKAGE_SMOKE === '1';
const temporary = await mkdtemp(resolve(tmpdir(), 'astro-aeo-package-smoke-'));
const packDirectory = resolve(temporary, 'pack');
await mkdir(packDirectory);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}`);
  }
  return result.stdout ?? '';
}

try {
  const output = run('npm', ['pack', '--json', '--pack-destination', packDirectory], { capture: true });
  const jsonStart = output.indexOf('[');
  const metadata = JSON.parse(output.slice(jsonStart))[0];
  const sizeErrors = [];
  const contentErrors = [];

  if (metadata.size > PACKED_LIMIT) {
    sizeErrors.push(`packed size ${metadata.size} exceeds ${PACKED_LIMIT} bytes`);
  }
  if (metadata.unpackedSize > UNPACKED_LIMIT) {
    sizeErrors.push(`unpacked size ${metadata.unpackedSize} exceeds ${UNPACKED_LIMIT} bytes`);
  }

  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const files = new Set(metadata.files.map((file) => file.path));
  const exportFiles = [];
  for (const value of Object.values(pkg.exports ?? {})) {
    if (typeof value === 'string') exportFiles.push(value);
    else if (value && typeof value === 'object') exportFiles.push(...Object.values(value));
  }
  for (const path of exportFiles.filter((value) => typeof value === 'string')) {
    const normalized = path.replace(/^\.\//, '');
    if (!files.has(normalized)) contentErrors.push(`export target is absent from tarball: ${path}`);
  }

  for (const required of [
    'README.md',
    'LICENSE',
    'src/index.js',
    'src/index.d.ts',
    'src/page.js',
    'src/page.d.ts',
    'src/extract.js',
    'src/extract.d.ts',
    'src/schema.js',
    'src/schema.d.ts',
    'src/adapters.d.ts',
    'src/adapters/mdx.js',
    'src/adapters/defuddle.js',
    'src/runtime/middleware.js',
    'src/runtime/middleware.d.ts',
    'components/index.js',
    'components/index.d.ts',
    'schema/astro-aeo.schema.json',
  ]) {
    if (!files.has(required)) contentErrors.push(`required package file is absent: ${required}`);
  }

  if (contentErrors.length > 0) throw new Error(contentErrors.join('\n'));
  if (sizeErrors.length > 0 && !allowSizeOverage) throw new Error(sizeErrors.join('\n'));
  for (const error of sizeErrors) console.warn(`SIZE OVERAGE ALLOWED FOR DIAGNOSTICS: ${error}`);
  console.log(
    `Packed ${metadata.filename}: ${metadata.size} bytes packed, ${metadata.unpackedSize} bytes unpacked, ${metadata.entryCount} files.`,
  );

  if (!inspectOnly) {
    const consumer = resolve(temporary, 'consumer');
    await mkdir(resolve(consumer, 'src/pages'), { recursive: true });
    const tarball = resolve(packDirectory, metadata.filename);
    const installedAstro = JSON.parse(
      await readFile(resolve(root, 'node_modules/astro/package.json'), 'utf8'),
    ).version;
    await writeFile(
      resolve(consumer, 'package.json'),
      `${JSON.stringify(
        {
          name: 'astro-aeo-packed-smoke',
          private: true,
          type: 'module',
          dependencies: { astro: installedAstro, 'astro-aeo': `file:${tarball}` },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      resolve(consumer, 'astro.config.mjs'),
      `import { defineConfig } from 'astro/config';\nimport aeo from 'astro-aeo';\n\nexport default defineConfig({\n  site: 'https://example.test',\n  integrations: [aeo()],\n});\n`,
    );
    await writeFile(
      resolve(consumer, 'pnpm-workspace.yaml'),
      'allowBuilds:\n  esbuild: true\n  sharp: false\n',
    );
    await writeFile(resolve(consumer, '.npmrc'), 'auto-install-peers=false\n');
    await writeFile(
      resolve(consumer, 'src/pages/index.astro'),
      `---\nimport { AeoPage, FaqJsonLd } from 'astro-aeo/components';\n---\n<html><head><title>Packed consumer</title><meta name="description" content="Tarball smoke test" /></head><body><main><AeoPage markdown="# Authored source" title="Packed consumer" /><h1>Packed consumer</h1><FaqJsonLd items={[{ question: 'Packed?', answer: 'Yes.' }]} /></main></body></html>\n`,
    );

    // Prefer the content-addressed store populated by the root's frozen install,
    // while allowing pnpm to fill a missing optional tarball. This also avoids
    // npm independently re-resolving Astro's fast-moving prerelease graph.
    run('pnpm', ['install', '--prefer-offline'], { cwd: consumer });
    const importTargets = ['astro-aeo', 'astro-aeo/page', 'astro-aeo/extract', 'astro-aeo/schema'];
    run(
      'node',
      [
        '--input-type=module',
        '-e',
        `const imports = ${JSON.stringify(importTargets)};
await Promise.all(imports.map((specifier) => import(specifier)));
for (const specifier of ['astro-aeo/components', 'astro-aeo/middleware']) import.meta.resolve(specifier);
const schema = (await import('astro-aeo/schema.json', { with: { type: 'json' } })).default;
const pkg = (await import('astro-aeo/package.json', { with: { type: 'json' } })).default;
if (schema.title !== 'Astro-AEO configuration' || pkg.name !== 'astro-aeo') process.exit(1);`,
      ],
      { cwd: consumer },
    );
    run(resolve(consumer, 'node_modules/.bin/astro'), ['build'], { cwd: consumer });

    const markdown = await readFile(resolve(consumer, 'dist/index.md'), 'utf8');
    if (!markdown.includes('# Authored source')) {
      throw new Error('packed Astro fixture did not preserve the authored Markdown source');
    }
    const installedSchema = JSON.parse(
      await readFile(resolve(consumer, 'node_modules/astro-aeo/schema/astro-aeo.schema.json'), 'utf8'),
    );
    if (installedSchema.title !== 'Astro-AEO configuration') {
      throw new Error('installed configuration schema is missing or invalid');
    }

    run(
      'node',
      [
        '--input-type=module',
        '-e',
        `const isExpectedMissingPeer = (error, peer) =>
  error?.code === 'ERR_MODULE_NOT_FOUND' &&
  String(error.message).startsWith("Cannot find package '" + peer + "' imported from ");
for (const [specifier, peer] of [['astro-aeo/mdx', '@mdx-js/mdx'], ['astro-aeo/defuddle', 'defuddle']]) {
  if (
    isExpectedMissingPeer({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED', message: "Cannot find package '" + peer + "' imported from smoke" }, peer) ||
    isExpectedMissingPeer({ code: 'ERR_MODULE_NOT_FOUND', message: "Cannot find module '/broken/adapter.js'" }, peer)
  ) process.exit(1);
  try { await import(specifier); process.exit(1); }
  catch (error) {
    if (!isExpectedMissingPeer(error, peer)) process.exit(1);
  }
}`,
      ],
      { cwd: consumer },
    );

    // Installing optional peers must be the only action that activates their
    // importable adapter subpaths. Core imports and the ordinary Astro build
    // above deliberately run before either peer is declared by the consumer.
    const installedMdx = JSON.parse(
      await readFile(resolve(root, 'node_modules/@mdx-js/mdx/package.json'), 'utf8'),
    ).version;
    const installedDefuddle = JSON.parse(
      await readFile(resolve(root, 'node_modules/defuddle/package.json'), 'utf8'),
    ).version;
    const consumerPackage = JSON.parse(await readFile(resolve(consumer, 'package.json'), 'utf8'));
    consumerPackage.dependencies['@mdx-js/mdx'] = installedMdx;
    consumerPackage.dependencies.defuddle = installedDefuddle;
    await writeFile(resolve(consumer, 'package.json'), `${JSON.stringify(consumerPackage, null, 2)}\n`);
    // This install must not be frozen. The consumer's manifest was just edited to
    // declare both optional peers, so its lockfile is intentionally stale here, and
    // pnpm defaults frozen-lockfile to true whenever CI is set.
    run('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], { cwd: consumer });
    run(
      'node',
      [
        '--input-type=module',
        '-e',
        `const [mdx, defuddle] = await Promise.all([import('astro-aeo/mdx'), import('astro-aeo/defuddle')]);
if (mdx.default?.apiVersion !== 1 || defuddle.default?.apiVersion !== 1) process.exit(1);
const mdxResult = await mdx.default.render({
  pathname: '/packed-mdx',
  html: '',
  source: { kind: 'mdx', body: '# Packed MDX' },
});
const defuddleResult = await defuddle.default.render({
  pathname: '/packed-defuddle',
  html: '<html><head><title>Packed</title></head><body><main><h1>Packed Defuddle</h1><p>Local body text.</p></main></body></html>',
  extraction: { selectors: ['main'], removeSelectors: [], keepSelectors: [] },
});
if (mdxResult.status !== 'rendered' || mdxResult.markdown !== '# Packed MDX') process.exit(1);
if (defuddleResult.status !== 'rendered' || !defuddleResult.markdown.includes('Packed Defuddle')) process.exit(1);`,
      ],
      { cwd: consumer },
    );
    console.log('Packed tarball imports and Astro fixture build passed.');
  }
} finally {
  if (keepTemporary) console.log(`Kept package smoke directory: ${temporary}`);
  else await rm(temporary, { recursive: true, force: true });
}

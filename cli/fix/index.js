// @ts-check
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { isSafeOutputPath } from '../../src/build/ownership.js';
import { commitFileTransaction } from '../../src/build/transaction.js';
import { fixHeadersFile } from './headers.js';
import { fixRenderYaml } from './render-yaml.js';
import { FixRefusal } from './shared.js';
import { SNIPPETS } from './snippets.js';
import { fixVercelJson } from './vercel-json.js';

export { FixRefusal };

const EDITABLE = /** @type {const} */ (['cloudflare', 'netlify', 'vercel', 'render']);

/**
 * Which provider configuration a project carries, from files alone.
 * @param {string} projectDir
 * @returns {Array<typeof EDITABLE[number]>}
 */
export function detectProviders(projectDir) {
  const has = (/** @type {string} */ name) => existsSync(join(projectDir, name));
  return EDITABLE.filter((provider) => ({
    cloudflare: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'functions'].some(has),
    netlify: has('netlify.toml') || has('netlify'),
    vercel: has('vercel.json') || has('.vercel'),
    render: has('render.yaml'),
  })[provider]);
}

/** @param {typeof EDITABLE[number]} provider @param {string} publicDir */
function targetFor(provider, publicDir) {
  if (provider === 'vercel') return 'vercel.json';
  if (provider === 'render') return 'render.yaml';
  return join(publicDir, '_headers');
}

/**
 * `astro-aeo fix`: make a static host serve `.md` companions as
 * `text/markdown; charset=utf-8`. A dry run unless `--write` is given.
 *
 * @param {string[]} args
 * @param {{ cwd?: string; now?: Date }} [context]
 * @returns {Promise<{ changed: boolean; written: boolean; output: string }>}
 */
export async function runFix(args, context = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        provider: { type: 'string' },
        service: { type: 'string' },
        'public-dir': { type: 'string', default: 'public' },
        write: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new FixRefusal(error instanceof Error ? error.message : String(error));
  }
  if (parsed.positionals.length > 1) throw new FixRefusal('fix accepts at most one projectDir');
  const projectDir = resolve(context.cwd ?? process.cwd(), parsed.positionals[0] ?? '.');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw new FixRefusal(`project directory not found: ${parsed.positionals[0]}`);

  const requested = parsed.values.provider;
  if (requested !== undefined && Object.hasOwn(SNIPPETS, requested)) {
    return { changed: false, written: false, output: `astro-aeo fix: ${requested} is not edited automatically. Add this yourself:\n\n${SNIPPETS[/** @type {keyof typeof SNIPPETS} */ (requested)]}` };
  }
  if (requested !== undefined && !EDITABLE.includes(/** @type {any} */ (requested))) {
    throw new FixRefusal(`--provider must be one of ${[...EDITABLE, ...Object.keys(SNIPPETS)].join(', ')}`);
  }
  const detected = detectProviders(projectDir);
  const publicDir = parsed.values['public-dir'] ?? 'public';
  const targets = new Set((requested ? [/** @type {typeof EDITABLE[number]} */ (requested)] : detected).map((provider) => targetFor(provider, publicDir)));
  if (targets.size === 0) {
    throw new FixRefusal(`no supported provider configuration found. Choose one with --provider (${EDITABLE.join(', ')}), or print a snippet with --provider ${Object.keys(SNIPPETS).join('|')}`);
  }
  if (targets.size > 1) {
    throw new FixRefusal(`this project is configured for several providers (${detected.join(', ')}); choose one with --provider`);
  }
  const provider = /** @type {typeof EDITABLE[number]} */ (requested ?? detected[0]);
  const relativeTarget = [...targets][0];
  const target = resolve(projectDir, relativeTarget);
  if (target !== projectDir && !target.startsWith(`${projectDir}${sep}`)) throw new FixRefusal(`${relativeTarget} is outside the project`);
  if (!isSafeOutputPath(projectDir, target)) throw new FixRefusal(`${relativeTarget} is reached through a symbolic link; nothing was changed`);
  const exists = existsSync(target);
  if (exists && (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile())) {
    throw new FixRefusal(`${relativeTarget} is not a regular file; nothing was changed`);
  }
  if (!exists && provider === 'render') throw new FixRefusal('render.yaml does not exist; create the service first');

  const before = exists ? readFileSync(target, 'utf8') : '';
  const result = provider === 'vercel'
    ? fixVercelJson(before)
    : provider === 'render'
      ? await fixRenderYaml(before, { service: parsed.values.service })
      : fixHeadersFile(before);
  const shown = relativeTarget.split(sep).join('/');
  if (result.status === 'unchanged') return { changed: false, written: false, output: `astro-aeo fix: ${shown} already serves .md as text/markdown. Nothing to do.\n` };

  const added = addedLines(before, result.text);
  if (!parsed.values.write) {
    return {
      changed: true,
      written: false,
      output: `astro-aeo fix: would ${exists ? 'update' : 'create'} ${shown} (dry run, nothing written):\n\n${added}\nRun again with --write to apply. The current file is backed up first.\n`,
    };
  }

  /** @type {import('../../src/build/transaction.js').FileOperation[]} */
  const operations = [];
  let backupShown = '';
  if (exists) {
    const stamp = (context.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const backup = join(projectDir, '.astro', 'aeo-backups', stamp, relativeTarget);
    if (existsSync(backup)) throw new FixRefusal(`a backup already exists at ${relative(projectDir, backup)}; try again in a second`);
    operations.push({ kind: 'write', path: backup, contents: readFileSync(target), mode: statSync(target).mode & 0o777, confineTo: projectDir });
    backupShown = relative(projectDir, backup).split(sep).join('/');
  }
  operations.push({
    kind: 'write',
    path: target,
    contents: result.text,
    ...(exists ? { mode: statSync(target).mode & 0o777 } : {}),
    confineTo: projectDir,
  });
  commitFileTransaction(operations);
  return {
    changed: true,
    written: true,
    output: `astro-aeo fix: ${exists ? 'updated' : 'created'} ${shown}${backupShown ? ` (backup: ${backupShown})` : ''}\n`,
  };
}

/** The lines a change adds, enough to review a small additive edit. @param {string} before @param {string} after */
function addedLines(before, after) {
  const remaining = new Map();
  for (const line of before.split(/\r?\n/)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const added = [];
  for (const line of after.split(/\r?\n/)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else added.push(`+ ${line}`);
  }
  return `${added.join('\n')}\n`;
}

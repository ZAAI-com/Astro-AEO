import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURES = join(REPO, 'fixtures/adapters');

const astroPackage = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBinName = typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro;
export const ASTRO_BIN = join(REPO, 'node_modules/astro', astroBinName);

/** @param {string} name */
export function fixture(name) {
  return join(FIXTURES, name);
}

/**
 * @param {string} name
 * @param {{ config?: string }} [options]
 */
export function buildAdapter(name, options = {}) {
  for (const generated of ['dist', '.wrangler', '.vercel', '.netlify']) {
    rmSync(join(fixture(name), generated), { recursive: true, force: true });
  }
  const args = [ASTRO_BIN, 'build', '--root', fixture(name)];
  if (options.config) args.push('--config', options.config);
  return execFileSync(process.execPath, args, {
    cwd: REPO,
    env: cleanEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** @param {string} file */
export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Return every relative import in generated JavaScript whose target is absent.
 * Provider manifests can look valid while referring to a missing chunk, so the
 * adapter gate validates the complete emitted module graph as well as filenames.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function unresolvedRelativeImports(root) {
  const failures = [];
  for (const file of filesBelow(root).filter((path) => /\.(?:mjs|js)$/.test(path))) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n')) {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
      const specifiers = [];
      const staticImport = line.match(
        /^\s*(?:import|export)\s+(?:.+?\s+from\s+)?["'](\.[^"']+)["']/,
      );
      if (staticImport) specifiers.push(staticImport[1]);
      for (const match of line.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)) {
        specifiers.push(match[1]);
      }
      for (const imported of specifiers) {
        const specifier = imported.replace(/[?#].*$/, '');
        const target = resolve(dirname(file), specifier);
        if (!existsSync(target)) failures.push(`${file}: ${specifier}`);
      }
    }
  }
  return failures;
}

/** @param {string} root */
export function emittedJavaScript(root) {
  return filesBelow(root)
    .filter((path) => /\.(?:mjs|js)$/.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

/** @param {string} path */
export function nonEmptyFile(path) {
  return existsSync(path) && statSync(path).size > 0;
}

/** @param {string} executable */
export function executableAvailable(executable) {
  try {
    execFileSync(executable, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: REPO,
    env: { ...cleanEnvironment(), ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  return { child, output: () => output };
}

/**
 * @param {string} base
 * @param {{ child: import('node:child_process').ChildProcess; output(): string }} process
 */
export async function waitForReady(base, process) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (process.child.exitCode !== null) {
      throw new Error(`Adapter server exited before becoming ready:\n${process.output()}`);
    }
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {
      // The runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Adapter server did not become ready:\n${process.output()}`);
}

/** @param {import('node:child_process').ChildProcess | undefined} child */
export async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  return env;
}

/** @param {string} root */
function filesBelow(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

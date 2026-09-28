// @ts-check
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deploymentFactsPath } from '../src/build/deployment-facts.js';
import { extractPageFacts } from '../src/audit/facts.js';
import { EDGE_MANIFEST_PATHNAME, readEdgeManifest } from '../src/runtime/edge/handler.js';
import { ACCEPT_CONTRACT } from './accept-contract.js';
import { FixRefusal, detectProviders } from './fix/index.js';
import { fixHeadersFile } from './fix/headers.js';
import { fixRenderYaml } from './fix/render-yaml.js';
import { fixVercelJson } from './fix/vercel-json.js';

/** A bad command line or an unreachable `--url`: exit status 2. */
export class DoctorInvocationError extends Error {}

/**
 * `configured`: verified against the deployment. `unverified`: the local
 * configuration looks right, which proves nothing about what is deployed.
 * `missing`: nothing provides it. `conflicting`: something contradicts it.
 *
 * @typedef {'configured' | 'missing' | 'conflicting' | 'unverified'} DoctorStatus
 * @typedef {{ id: string; status: DoctorStatus; message: string; hint?: string }} DoctorCheck
 */

const ENTRY_FILES = Object.freeze({
  cloudflare: ['functions/_middleware.js', 'functions/_middleware.ts', 'worker.js', 'src/worker.js', 'src/index.js', 'src/worker.ts', 'src/index.ts'],
  netlify: ['netlify/edge-functions'],
  vercel: ['middleware.js', 'middleware.ts', 'middleware.mjs', 'src/middleware.js', 'src/middleware.ts'],
});
const PROBE_TIMEOUT = 10_000;

/**
 * @param {string[]} args
 * @param {{ cwd?: string; fetch?: typeof globalThis.fetch }} [context]
 * @returns {Promise<{ exitCode: 0 | 1; output: string; checks: DoctorCheck[] }>}
 */
export async function runDoctor(args, context = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        dist: { type: 'string', default: 'dist' },
        'public-dir': { type: 'string', default: 'public' },
        json: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new DoctorInvocationError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.positionals.length > 1) throw new DoctorInvocationError('doctor accepts at most one projectDir');
  const projectDir = resolve(context.cwd ?? process.cwd(), parsed.positionals[0] ?? '.');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new DoctorInvocationError(`project directory not found: ${parsed.positionals[0]}`);
  }

  const facts = readFacts(projectDir);
  /** @type {DoctorCheck[]} */
  const checks = [
    facts
      ? { id: 'build-facts', status: 'configured', message: `last build: ${facts.output} output, ${facts.adapter ?? 'no adapter'}, negotiation ${facts.negotiation}` }
      : { id: 'build-facts', status: 'missing', message: 'no build facts found', hint: 'run `astro build` with astro-aeo 1.4 or newer, then run doctor again' },
    await mimeCheck(projectDir, parsed.values['public-dir'] ?? 'public'),
    negotiationCheck(projectDir, resolve(projectDir, parsed.values.dist ?? 'dist'), facts),
  ];

  if (parsed.values.url) {
    const probed = await probe(parsed.values.url, facts?.negotiation ?? 'off', context.fetch ?? globalThis.fetch);
    for (const result of probed) {
      const index = checks.findIndex((check) => check.id === result.id);
      // The deployment is the authority: a probe result replaces the local reading.
      if (index >= 0) checks[index] = result;
      else checks.push(result);
    }
  }

  const failed = checks.some((check) => check.status === 'missing' || check.status === 'conflicting');
  const output = parsed.values.json
    ? `${JSON.stringify({ version: 1, ...(parsed.values.url ? { url: parsed.values.url } : {}), checks }, null, 2)}\n`
    : render(checks, Boolean(parsed.values.url));
  return { exitCode: failed ? 1 : 0, output, checks };
}

/** @param {string} projectDir @returns {Record<string, any> | null} */
function readFacts(projectDir) {
  try {
    const facts = JSON.parse(readFileSync(deploymentFactsPath(projectDir), 'utf8'));
    return facts?.version === 1 && typeof facts.negotiation === 'string' ? facts : null;
  } catch {
    return null;
  }
}

/**
 * Would `astro-aeo fix` change anything? The same editors answer, so the two
 * commands cannot disagree.
 *
 * @param {string} projectDir @param {string} publicDir @returns {Promise<DoctorCheck>}
 */
async function mimeCheck(projectDir, publicDir) {
  const id = 'markdown-mime';
  const providers = detectProviders(projectDir);
  const targets = new Set(providers.map((provider) =>
    provider === 'vercel' ? 'vercel.json' : provider === 'render' ? 'render.yaml' : join(publicDir, '_headers')));
  if (targets.size === 0) {
    return { id, status: 'unverified', message: 'no provider configuration found, so how .md files are served is unknown', hint: 'pass --url to check the deployment, or see `astro-aeo fix --provider nginx|apache|node|workers|deno`' };
  }
  if (targets.size > 1) {
    return { id, status: 'conflicting', message: `several providers are configured (${providers.join(', ')})`, hint: 'run `astro-aeo fix --provider <name>` for the one you deploy to' };
  }
  const target = [...targets][0];
  const path = join(projectDir, target);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  try {
    const result = target === 'vercel.json'
      ? fixVercelJson(text)
      : target === 'render.yaml'
        ? await fixRenderYaml(text)
        : fixHeadersFile(text);
    return result.status === 'unchanged'
      ? { id, status: 'unverified', message: `${target} serves .md as text/markdown`, hint: 'local configuration only; pass --url to verify the deployment' }
      : { id, status: 'missing', message: `${target} does not set the Markdown content type`, hint: 'run `astro-aeo fix --write`' };
  } catch (error) {
    if (!(error instanceof FixRefusal)) throw error;
    return { id, status: 'conflicting', message: error.message };
  }
}

/** @param {string} projectDir @param {string} distDir @param {Record<string, any> | null} facts @returns {DoctorCheck} */
function negotiationCheck(projectDir, distDir, facts) {
  const id = 'negotiation';
  if (!facts) return { id, status: 'unverified', message: 'unknown until a build records its configuration' };
  if (facts.negotiation === 'off') return { id, status: 'configured', message: 'markdown.negotiation is off, so there is nothing to deploy' };
  if (facts.adapter) {
    return { id, status: 'unverified', message: `the Astro middleware negotiates on-demand routes through ${facts.adapter}`, hint: 'prerendered routes cannot negotiate; pass --url to verify the deployment' };
  }
  /** @type {keyof typeof ENTRY_FILES | null} */
  const provider = facts.edgeProvider ?? null;
  if (!provider) {
    return { id, status: 'missing', message: `markdown.negotiation is "${facts.negotiation}" but this static site has nothing that can negotiate`, hint: 'add a static edge plugin from astro-aeo/edge/cloudflare, /netlify or /vercel' };
  }
  const manifestPath = join(distDir, (facts.base === '/' ? '' : facts.base) + EDGE_MANIFEST_PATHNAME);
  let manifest = null;
  try {
    manifest = readEdgeManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    // Reported below.
  }
  if (!manifest) return { id, status: 'missing', message: 'the build output has no valid edge manifest', hint: 'run `astro build` again and deploy its output' };
  if (!hasHandler(projectDir, provider)) {
    return { id, status: 'missing', message: `no ${provider} handler entry imports astro-aeo/edge/${provider}`, hint: `create one of: ${ENTRY_FILES[provider].join(', ')}` };
  }
  return { id, status: 'unverified', message: `${provider} edge handler and a manifest of ${manifest.routes.size} route(s) are in place`, hint: 'local configuration only; pass --url to verify the deployment' };
}

/** @param {string} projectDir @param {keyof typeof ENTRY_FILES} provider */
function hasHandler(projectDir, provider) {
  const mentions = (/** @type {string} */ path) => {
    try {
      return readFileSync(path, 'utf8').includes(`astro-aeo/edge/${provider}`);
    } catch {
      return false;
    }
  };
  return ENTRY_FILES[provider].some((entry) => {
    const path = join(projectDir, entry);
    if (!existsSync(path)) return false;
    return statSync(path).isDirectory() ? readdirSync(path).some((name) => mentions(join(path, name))) : mentions(path);
  });
}

/**
 * A bounded, anonymous probe of one deployed page: a fixed number of requests to
 * the origin given, no cookie, no credential, no redirect followed.
 *
 * @param {string} target @param {string} negotiation @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<DoctorCheck[]>}
 */
async function probe(target, negotiation, fetchImpl) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new DoctorInvocationError(`not a valid URL: ${target}`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new DoctorInvocationError('--url must be an http(s) URL without credentials');
  }
  /** @param {string | URL} input @param {Record<string, string>} [headers] @param {string} [method] */
  const request = (input, headers = {}, method = 'GET') => fetchImpl(input, {
    method,
    headers,
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  });

  let page;
  try {
    page = await request(url, { accept: 'text/html' });
  } catch {
    throw new DoctorInvocationError(`could not reach ${url.href}`);
  }
  if (!page.ok) throw new DoctorInvocationError(`${url.href} answered HTTP ${page.status}`);
  const facts = extractPageFacts(await page.text(), { url: url.href });

  /** @type {DoctorCheck[]} */
  const checks = [];
  const alternate = facts.markdownAlternates[0];
  if (!alternate) {
    checks.push({ id: 'markdown-mime', status: 'missing', message: 'the page advertises no Markdown alternate link, so no companion could be checked' });
  } else {
    const companionUrl = new URL(alternate, url);
    if (companionUrl.origin !== url.origin) {
      checks.push({ id: 'markdown-mime', status: 'conflicting', message: 'the Markdown alternate link points at another origin' });
    } else {
      const companion = await request(companionUrl);
      const type = companion.headers.get('content-type') ?? '';
      await companion.body?.cancel();
      checks.push(companion.ok && /^text\/markdown\b/i.test(type)
        ? { id: 'markdown-mime', status: 'configured', message: `${companionUrl.pathname} is served as ${type}` }
        : { id: 'markdown-mime', status: 'conflicting', message: `${companionUrl.pathname} answered HTTP ${companion.status} as "${type || 'no content type'}"`, hint: 'run `astro-aeo fix --write` and redeploy' });
    }
  }

  /** @type {string[]} */
  const mismatches = [];
  for (const entry of ACCEPT_CONTRACT) {
    const response = await request(url, entry.accept === null ? {} : { accept: entry.accept });
    const type = response.headers.get('content-type') ?? '';
    await response.body?.cancel();
    const gotMarkdown = negotiation === 'redirect' ? response.status === 303 : /^text\/markdown\b/i.test(type);
    if (gotMarkdown !== (negotiation !== 'off' && entry.markdown)) mismatches.push(`${entry.name} (Accept: ${entry.accept ?? 'none'})`);
    if (negotiation !== 'off' && !/(?:^|,)\s*accept\s*(?:,|$)/i.test(response.headers.get('vary') ?? '')) {
      mismatches.push(`${entry.name}: no Vary: Accept`);
    }
  }
  if (negotiation === 'response') {
    const head = await request(url, { accept: 'text/markdown' }, 'HEAD');
    if (!/^text\/markdown\b/i.test(head.headers.get('content-type') ?? '')) mismatches.push('HEAD does not negotiate');
    const etag = head.headers.get('etag');
    if (etag) {
      const conditional = await request(url, { accept: 'text/markdown', 'if-none-match': etag });
      await conditional.body?.cancel();
      if (conditional.status !== 304) mismatches.push(`If-None-Match answered ${conditional.status}, not 304`);
    }
  }
  checks.push(mismatches.length === 0
    ? { id: 'negotiation', status: 'configured', message: `the deployment matches all ${ACCEPT_CONTRACT.length} Accept cases for negotiation "${negotiation}"` }
    : { id: 'negotiation', status: 'conflicting', message: `${mismatches.length} Accept check(s) disagree with negotiation "${negotiation}", first: ${mismatches[0]}` });
  return checks;
}

const MARKS = Object.freeze({ configured: 'ok', unverified: '??', missing: '--', conflicting: '!!' });

/** @param {DoctorCheck[]} checks @param {boolean} probed */
function render(checks, probed) {
  const lines = checks.flatMap((check) => [
    `  ${MARKS[check.status]} ${check.id.padEnd(14)} ${check.status.padEnd(12)} ${check.message}`,
    ...(check.hint ? [`     ${' '.repeat(14)} ${' '.repeat(12)} ${check.hint}`] : []),
  ]);
  const unverified = checks.filter((check) => check.status === 'unverified').length;
  lines.push('', probed || unverified === 0
    ? 'astro-aeo doctor: done'
    : `astro-aeo doctor: ${unverified} check(s) rest on local files only. Pass --url <page> to verify the deployment.`);
  return `${lines.join('\n')}\n`;
}

// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deploymentFactsPath } from '../src/build/deployment-facts.js';
import { fileEtag, isSafeOutputPath, isUnlinkedDirectory, outputRootId, ownershipManifestPath, readOwnershipManifest, resolveRecordedOutputPath } from '../src/build/ownership.js';
import { extractPageFacts } from '../src/audit/facts.js';
import { EDGE_MANIFEST_PATHNAME, readEdgeManifest } from '../src/runtime/edge/handler.js';
import { ACCEPT_CONTRACT } from './accept-contract.js';
import { FixRefusal, detectProviders } from './fix/index.js';
import { fixHeadersFile } from './fix/headers.js';
import { fixRenderYaml } from './fix/render-yaml.js';
import { fixVercelJson } from './fix/vercel-json.js';
import { SNIPPETS } from './fix/snippets.js';

/** A bad command line or an unreachable `--url`: exit status 2. */
export class DoctorInvocationError extends Error {}

/**
 * `configured`: verified against the deployment. `unverified`: the local
 * configuration looks right, which proves nothing about what is deployed.
 * `missing`: nothing provides it. `conflicting`: something contradicts it.
 *
 * @typedef {'configured' | 'missing' | 'conflicting' | 'unverified'} DoctorStatus
 * @typedef {{ source: string; confidence: 'low' | 'medium' | 'high'; detail: string }} DoctorEvidence
 * @typedef {{ id: string; status: DoctorStatus; message: string; hint?: string; evidence?: DoctorEvidence[] }} DoctorCheck
 * @typedef {{ id: string; message: string; snippet?: string }} DoctorAdvice
 */

const ENTRY_FILES = Object.freeze({
  cloudflare: ['functions/_middleware.js', 'functions/_middleware.ts', 'worker.js', 'src/worker.js', 'src/index.js', 'src/worker.ts', 'src/index.ts'],
  netlify: ['netlify/edge-functions'],
  vercel: ['middleware.js', 'middleware.ts', 'middleware.mjs', 'src/middleware.js', 'src/middleware.ts'],
});
const PROBE_TIMEOUT = 10_000;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const CONFIG_FILES = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts', 'astro.config.cjs', 'astro.config.cts'];
const OVERLAPPING_PACKAGES = Object.freeze({
  '@astrojs/sitemap': { feature: 'sitemap', advice: 'Astro-AEO detects an already registered sitemap integration. Keep its options; use discovery.sitemap.mode: "external" if another integration owns registration.' },
  '@astrojs/starlight': { feature: 'sitemap', advice: 'Use astro-aeo/starlight for Starlight defaults, including external sitemap registration. Do not register a second aeo() integration.' },
  'astro-robots-txt': { feature: 'robots.txt', advice: 'Choose one robots.txt producer. If the other integration owns it, disable discovery.robots.enabled in Astro-AEO after reviewing its existing policy.' },
  'astro-llms-txt': { feature: 'llms.txt', advice: 'Choose one llms.txt producer. If the other integration owns it, disable corpus.index.enabled in Astro-AEO after reviewing its output.' },
});

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
        print: { type: 'boolean', default: false },
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
  if (!isUnlinkedDirectory(projectDir)) throw new DoctorInvocationError('project directory is reached through a symbolic link');

  const facts = readFacts(projectDir);
  const distDir = resolve(projectDir, parsed.values.dist ?? 'dist');
  /** @type {DoctorCheck[]} */
  const checks = [
    facts
      ? { id: 'build-facts', status: 'unverified', message: `last local build: ${facts.output} output, ${facts.adapter ?? 'no adapter'}, negotiation ${facts.negotiation}` }
      : { id: 'build-facts', status: 'missing', message: 'no build facts found', hint: 'run `astro build` with astro-aeo 1.4 or newer, then run doctor again' },
    await mimeCheck(projectDir, parsed.values['public-dir'] ?? 'public'),
    negotiationCheck(projectDir, distDir, facts),
    ...providerEvidence(projectDir, facts),
    ...ownershipChecks(projectDir, distDir, facts),
    ...packageOverlapChecks(projectDir),
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
  const advice = parsed.values.print ? adviceFor(checks) : undefined;
  const output = parsed.values.json
    ? `${JSON.stringify({ version: 1, ...(parsed.values.url ? { url: parsed.values.url } : {}), checks, ...(advice ? { advice } : {}) }, null, 2)}\n`
    : render(checks, Boolean(parsed.values.url)) + (advice ? renderAdvice(advice) : '');
  return { exitCode: failed ? 1 : 0, output, checks };
}

/** @param {string} projectDir @returns {Record<string, any> | null} */
function readFacts(projectDir) {
  try {
    const facts = JSON.parse(readLocalText(projectDir, deploymentFactsPath(projectDir)) ?? 'null');
    return facts?.version === 1 && ['static', 'server'].includes(facts.output) &&
      ['off', 'response', 'redirect'].includes(facts.negotiation) &&
      (facts.adapter === null || (typeof facts.adapter === 'string' && /^[@a-z\d][a-z\d@/._-]*$/i.test(facts.adapter))) &&
      (facts.edgeProvider === null || Object.hasOwn(ENTRY_FILES, facts.edgeProvider)) &&
      typeof facts.base === 'string' && /^\/(?!\/)/.test(facts.base) &&
      !facts.base.split('/').includes('..') ? facts : null;
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
  const text = readLocalText(projectDir, path);
  if (!isSafeOutputPath(projectDir, path) || (existsSync(path) && text === null)) {
    return { id, status: 'conflicting', message: 'the provider configuration is unreadable, too large, outside the project or reached through a symbolic link' };
  }
  try {
    const result = target === 'vercel.json'
      ? fixVercelJson(text ?? '')
      : target === 'render.yaml'
        ? await fixRenderYaml(text ?? '')
        : fixHeadersFile(text ?? '');
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
  if (facts.negotiation === 'off') return { id, status: 'unverified', message: 'the local build disables markdown.negotiation', hint: 'pass --url to verify that the deployment also leaves HTML requests unchanged' };
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
    manifest = readEdgeManifest(JSON.parse(readLocalText(distDir, manifestPath) ?? 'null'));
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
    return readLocalText(projectDir, path)?.includes(`astro-aeo/edge/${provider}`) ?? false;
  };
  return ENTRY_FILES[provider].some((entry) => {
    const path = join(projectDir, entry);
    if (!isSafeOutputPath(projectDir, path) || !existsSync(path) || lstatSync(path).isSymbolicLink()) return false;
    return lstatSync(path).isDirectory() ? readdirSync(path).some((name) => mentions(join(path, name))) : mentions(path);
  });
}

/** Read bounded local evidence, never a symlink, directory or executable module.
 * @param {string} root @param {string} path @param {number} [limit]
 */
function readLocalText(root, path, limit = MAX_EVIDENCE_BYTES) {
  if (!isUnlinkedDirectory(root) || !isSafeOutputPath(root, path)) return null;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > limit) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Local server files are evidence of intent, never proof of a deployed MIME rule.
 * @param {string} projectDir @param {Record<string, any> | null} facts
 * @returns {DoctorCheck[]}
 */
function providerEvidence(projectDir, facts) {
  const candidates = {
    node: ['server.js', 'server.mjs', 'server.ts', 'src/server.js', 'src/server.ts'],
    deno: ['deno.json', 'deno.jsonc', 'main.ts', 'server.ts'],
    nginx: ['nginx.conf', 'conf/nginx.conf'],
    apache: ['.htaccess', 'public/.htaccess', 'httpd.conf', 'apache.conf'],
  };
  /** @type {DoctorCheck[]} */
  const checks = [];
  for (const [provider, files] of Object.entries(candidates)) {
    /** @type {DoctorEvidence[]} */
    const evidence = [];
    const adapter = provider === 'node' ? '@astrojs/node' : provider === 'deno' ? '@deno/astro-adapter' : null;
    if (adapter && facts?.adapter === adapter) {
      evidence.push({ source: '.astro/aeo-cache/deployment-v1.json', confidence: 'high', detail: `the last build names ${adapter}` });
    }
    for (const name of files) {
      const text = readLocalText(projectDir, join(projectDir, name));
      if (text === null) continue;
      // Generic server names alone do not identify Node or Deno.
      if (provider === 'node' && !/node:|express\s*[.(]|@astrojs\/node/.test(text)) continue;
      if (provider === 'deno' && !name.startsWith('deno.') && !/Deno\.|jsr:@std\/http|@deno\//.test(text)) continue;
      evidence.push({ source: name, confidence: 'medium', detail: /text\/markdown/i.test(text)
        ? 'local text mentions the Markdown MIME type; rule scope and deployment are unverified'
        : 'local server configuration is present; Markdown MIME coverage is unverified' });
    }
    if (evidence.length) checks.push({
      id: `provider-${provider}`, status: 'unverified', evidence,
      message: `${provider} has local deployment evidence only`,
      hint: `use --url to probe serving behavior, or --print for a manual ${provider} MIME example`,
    });
  }
  return checks;
}

/** Inspect the writer's existing decisions; doctor never arbitrates or changes ownership.
 * @param {string} projectDir @param {string} distDir @param {Record<string, any> | null} facts
 * @returns {DoctorCheck[]}
 */
function ownershipChecks(projectDir, distDir, facts) {
  const path = ownershipManifestPath(projectDir);
  if (readLocalText(projectDir, path, 16 * MAX_EVIDENCE_BYTES) === null) {
    try {
      lstatSync(path);
    } catch {
      return [];
    }
    return [{ id: 'build-evidence', status: 'conflicting', message: 'the private ownership ledger is unsafe, unreadable or too large', hint: 'rebuild before using this evidence; no artifact conclusions were drawn' }];
  }
  const ownership = readOwnershipManifest(projectDir);
  if (!ownership) return [{ id: 'build-evidence', status: 'conflicting', message: 'the private ownership ledger is invalid', hint: 'rebuild before using this evidence' }];
  const digest = `sha256:${createHash('sha256').update(ownership.artifacts.map((/** @type {any} */ entry) => `${entry.status} ${entry.pathname}`).sort().join('\n')).digest('hex')}`;
  if (ownership.outputRootId !== outputRootId(distDir) || (facts?.ownershipDigest && facts.ownershipDigest !== digest)) {
    return [{ id: 'build-evidence', status: 'conflicting', message: 'the build output, deployment facts and ownership ledger do not identify the same build', hint: 'use the matching --dist directory, or rebuild; no artifact conclusions were drawn from mismatched evidence' }];
  }
  /** @type {DoctorCheck[]} */
  const checks = [{ id: 'build-evidence', status: 'unverified', message: facts?.ownershipDigest ? 'local deployment and ownership evidence agree; deployed bytes remain unverified' : 'the local ownership ledger matches the selected output; deployment identity remains unverified' }];
  const conflicts = ownership.artifacts.filter((/** @type {any} */ entry) => entry.status === 'conflict' || entry.status === 'group-skipped');
  const preserved = ownership.artifacts.filter((/** @type {any} */ entry) => entry.status === 'preserved');
  checks.push({
    id: 'artifact-ownership', status: conflicts.length ? 'conflicting' : 'unverified',
    message: conflicts.length
      ? `the build writer recorded ${conflicts.length} conflicting or skipped artifact claim(s)`
      : `the build writer recorded no conflicting claims and preserved ${preserved.length} externally owned artifact(s)`,
    ...(conflicts.length ? { hint: 'review the existing build arbitration diagnostics; doctor does not replace routes or other generators' } : {}),
  });
  const emitted = ownership.artifacts.filter((/** @type {any} */ entry) => entry.status === 'emitted');
  let missing = 0;
  let changed = 0;
  for (const artifact of emitted) {
    const path = isUnlinkedDirectory(distDir) ? resolveRecordedOutputPath(distDir, artifact.outputPath) : null;
    try {
      if (!path || !lstatSync(path).isFile()) missing++;
      else if (fileEtag(path) !== artifact.representation.etag) changed++;
    } catch {
      missing++;
    }
  }
  if (emitted.length) checks.push({
    id: 'emitted-artifacts', status: changed ? 'conflicting' : missing ? 'missing' : 'unverified',
    message: `${emitted.length} emitted artifact(s) checked locally: ${missing} missing or unsafe, ${changed} changed`,
    ...(missing || changed ? { hint: 'rebuild the output before deploying it' } : {}),
  });
  return checks;
}

/** Installed packages and textual config references are advisory, never active-config proof.
 * @param {string} projectDir @returns {DoctorCheck[]}
 */
function packageOverlapChecks(projectDir) {
  let declared = {};
  try {
    const pkg = JSON.parse(readLocalText(projectDir, join(projectDir, 'package.json')) ?? '{}');
    declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  } catch {
    return [{ id: 'package-evidence', status: 'unverified', message: 'package.json could not be read as JSON; no package overlap advice was inferred' }];
  }
  const configs = CONFIG_FILES.map((name) => ({ name, text: readLocalText(projectDir, join(projectDir, name)) }));
  /** @type {DoctorCheck[]} */
  const checks = [];
  for (const [name, overlap] of Object.entries(OVERLAPPING_PACKAGES)) {
    /** @type {DoctorEvidence[]} */
    const evidence = [];
    if (Object.hasOwn(declared, name)) evidence.push({ source: 'package.json', confidence: 'low', detail: `${name} is declared directly; installation does not prove use` });
    for (const config of configs) {
      if (config.text?.includes(`'${name}'`) || config.text?.includes(`"${name}"`)) {
        evidence.push({ source: config.name, confidence: 'medium', detail: `${name} appears as a quoted config reference; comments and inactive configuration may also match` });
      }
    }
    if (evidence.length) checks.push({
      id: `package-overlap:${name}`, status: 'unverified', evidence,
      message: `${name} may share ${overlap.feature} responsibilities; this is not a detected collision`,
      hint: overlap.advice,
    });
  }
  return checks;
}

/** @param {DoctorCheck[]} checks @returns {DoctorAdvice[]} */
function adviceFor(checks) {
  return checks.flatMap((check) => {
    if (check.id.startsWith('provider-')) {
      const provider = check.id.slice('provider-'.length);
      return [{ id: check.id, message: 'Review this example against the actual server configuration. It is not an automatic migration.', snippet: SNIPPETS[/** @type {keyof typeof SNIPPETS} */ (provider)] }];
    }
    return check.hint ? [{ id: check.id, message: check.hint }] : [];
  });
}

/** @param {DoctorAdvice[]} advice */
function renderAdvice(advice) {
  return '\nManual configuration advice (nothing executed or written):\n' +
    (advice.length ? advice.map((entry) => `\n${entry.id}: ${entry.message}\n${entry.snippet ? `\n${entry.snippet}` : ''}`).join('') : 'No additional advice from the available local evidence.\n');
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
    ...(check.evidence ?? []).map((entry) => `     evidence (${entry.confidence}): ${entry.source}: ${entry.detail}`),
    ...(check.hint ? [`     ${' '.repeat(14)} ${' '.repeat(12)} ${check.hint}`] : []),
  ]);
  const unverified = checks.filter((check) => check.status === 'unverified').length;
  lines.push('', probed || unverified === 0
    ? 'astro-aeo doctor: done'
    : `astro-aeo doctor: ${unverified} check(s) rest on local files only. Pass --url <page> to verify the deployment.`);
  return `${lines.join('\n')}\n`;
}

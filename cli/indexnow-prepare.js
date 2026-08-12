// @ts-check
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  INDEXNOW_ACK_FILENAME,
  INDEXNOW_ACK_VERSION,
  INDEXNOW_PENDING_FILENAME,
  INDEXNOW_PREPARE_INPUT_FILENAME,
  INDEXNOW_QUEUE_VERSION,
  parseIndexNowAcknowledgment,
  parseIndexNowPrepareInput,
  parseIndexNowQueue,
  parseIndexNowStateManifest,
  prepareIndexNowQueue,
  serializeIndexNowAcknowledgment,
  serializeIndexNowQueue,
} from '../src/build/indexnow-state.js';
import { IndexNowInvocationError, errorMessage, readJsonFile, writePrivateFile } from './indexnow-io.js';
import { createSafeHttpsTransport } from './indexnow-submit.js';
import { INDEXNOW_PREPARE_PROVIDER } from '../src/build/indexnow.js';

/**
 * @typedef {{
 *   source?: 'cache'|'config';
 *   input?: string;
 *   projectRoot?: string;
 *   fetch?: typeof globalThis.fetch;
 *   transport?: import('./indexnow-submit.js').IndexNowTransport;
 *   loadConfig?: (root: string) => Promise<unknown>;
 * }} PrepareOptions
 */

/**
 * Recompute the pending queue without resolving any key material. Builds call
 * the same state helpers directly; this command exists for deployment jobs that
 * need to refresh acknowledgment input before transferring the private queue.
 * @param {string} distDir
 * @param {PrepareOptions} [options]
 */
export async function prepareIndexNow(distDir, options = {}) {
  const source = options.source ?? 'cache';
  if (!['cache', 'config'].includes(source)) throw new IndexNowInvocationError('indexnow prepare --source must be cache or config');
  if (source === 'config' && options.input) throw new IndexNowInvocationError('--input is valid only with --source cache');
  const root = resolve(options.projectRoot ?? process.cwd());
  const cacheDir = join(root, '.astro', 'aeo-cache', 'indexnow');
  const inputPath = resolve(options.input ?? join(cacheDir, INDEXNOW_PREPARE_INPUT_FILENAME));
  const outputRoot = resolve(distDir);
  const input = source === 'cache'
    ? parseInput(readJsonFile(inputPath))
    : parseInput(await loadConfigInput(root, outputRoot, options.loadConfig));
  const ackPath = join(cacheDir, INDEXNOW_ACK_FILENAME);
  const queuePath = join(cacheDir, INDEXNOW_PENDING_FILENAME);
  const priorAck = readOptionalAcknowledgment(ackPath);
  const priorQueue = readOptionalQueue(queuePath);
  const fetchImpl = options.fetch;
  const transport = options.transport ?? (fetchImpl ? undefined : createSafeHttpsTransport());
  const localPublicState = input.mode === 'public'
    ? readLocalPublicState(outputRoot, input.statePathname, input.base)
    : undefined;
  const byOrigin = groupCurrentOrigins(input.current);
  const configuredOrigins = configuredOriginMap(input);
  const allOrigins = [...new Set([
    ...byOrigin.keys(),
    ...configuredOrigins.keys(),
    ...priorAck.origins.map((item) => item.origin),
    ...priorQueue.origins.map((item) => item.origin),
  ])].sort(codeUnitCompare);
  const warnings = [];
  /** @type {Map<string, import('../src/build/indexnow-state.js').UrlFingerprint[]>} */
  const publicAcknowledgments = new Map();

  for (const origin of allOrigins) {
    const privateAck = priorAck.origins.find((item) => item.origin === origin)?.acknowledged;
    const stateUrl = new URL(input.statePathname, `${origin}/`).href;
    if (!privateAck && input.mode === 'public') {
      try {
        const acknowledged = (
          fetchImpl
            ? await fetchPublicState(fetchImpl, stateUrl, origin)
            : await requestPublicState(/** @type {import('./indexnow-submit.js').IndexNowTransport} */ (transport), stateUrl, origin)
        ).acknowledged.urls;
        publicAcknowledgments.set(origin, acknowledged);
      } catch (error) {
        warnings.push(`IndexNow could not use deployed state for ${origin}: ${errorMessage(error)}`);
      }
    }
  }

  const targetDigests = new Map();
  if (localPublicState) targetDigests.set(localPublicState.origin, localPublicState.digest);
  const prepared = prepareIndexNowQueue(input, {
    acknowledgment: priorAck,
    priorQueue,
    publicAcknowledgments,
    targetDigests,
  });
  warnings.push(...prepared.warnings);
  writePrivateFile(queuePath, serializeIndexNowQueue(prepared.queue));
  // Persist a validated normalization of the source used for the diff. This is
  // not an acknowledgment of submission, but retaining prior ack atomically
  // makes a transferred directory self-contained.
  writePrivateFile(ackPath, serializeIndexNowAcknowledgment(prepared.acknowledgment));
  return {
    queuePath,
    acknowledgmentPath: ackPath,
    origins: prepared.queue.origins.length,
    operations: prepared.queue.origins.reduce((total, item) => total + item.operations.length, 0),
    warnings,
    distDir: outputRoot,
  };
}

/** @param {string} outputRoot @param {string} statePathname @param {string} base */
function readLocalPublicState(outputRoot, statePathname, base) {
  const normalizedBase = base === '/' ? '' : base.replace(/\/$/u, '');
  const relativePathname = normalizedBase && statePathname.startsWith(`${normalizedBase}/`)
    ? statePathname.slice(normalizedBase.length)
    : statePathname;
  const path = join(outputRoot, ...relativePathname.replace(/^\/+/, '').split('/'));
  if (!existsSync(path)) return undefined;
  const value = readJsonFile(path);
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.origin !== 'string') {
    throw new IndexNowInvocationError('the built public IndexNow state has an invalid shape');
  }
  try { return parseIndexNowStateManifest(value, value.origin); }
  catch (error) { throw new IndexNowInvocationError(`the built public IndexNow state is invalid: ${errorMessage(error)}`); }
}

/** @param {unknown} value */
function parseInput(value) {
  try { return parseIndexNowPrepareInput(value); }
  catch (error) { throw new IndexNowInvocationError(`invalid IndexNow prepare input: ${errorMessage(error)}`); }
}

/** @param {string} root @param {string} distDir @param {PrepareOptions['loadConfig']} loader */
async function loadConfigInput(root, distDir, loader) {
  if (loader) return loader(root);
  try {
    const packagePath = fileURLToPath(import.meta.resolve('astro/package.json'));
    const configModuleUrl = pathToFileURL(join(dirname(packagePath), 'dist', 'core', 'config', 'config.js'));
    const configModule = await import(configModuleUrl.href);
    const loaded = await configModule.resolveConfig({ root }, 'build');
    const integrations = /** @type {any[]} */ (loaded?.userConfig?.integrations ?? []);
    const integration = integrations.find((item) => item?.name === 'astro-aeo');
    const provider = integration?.[INDEXNOW_PREPARE_PROVIDER];
    if (typeof provider === 'function') {
      return provider({ root, distDir, astroConfig: loaded.astroConfig });
    }
    if (provider && typeof provider === 'object') return provider;
  } catch (error) {
    throw new IndexNowInvocationError(`cannot load Astro config: ${errorMessage(error)}`);
  }
  throw new IndexNowInvocationError(
    'the loaded Astro config has no enabled Astro-AEO IndexNow prepare provider',
  );
}

/** @param {string} path */
function readOptionalAcknowledgment(path) {
  if (!existsSync(path)) return { version: /** @type {const} */ (1), origins: [] };
  try { return parseIndexNowAcknowledgment(readJsonFile(path)); }
  catch (error) { throw new IndexNowInvocationError(`invalid IndexNow acknowledgment ledger: ${errorMessage(error)}`); }
}

/** @param {string} path */
function readOptionalQueue(path) {
  if (!existsSync(path)) return { version: /** @type {const} */ (1), origins: [] };
  try { return parseIndexNowQueue(readJsonFile(path)); }
  catch (error) { throw new IndexNowInvocationError(`invalid IndexNow pending queue: ${errorMessage(error)}`); }
}

/** @param {import('../src/build/indexnow-state.js').IndexNowPrepareInputV1} input */
function configuredOriginMap(input) {
  return new Map(input.origins.map((item) => [item.origin, item]));
}

/** @param {import('../src/build/indexnow-state.js').UrlFingerprint[]} values */
function groupCurrentOrigins(values) {
  const output = new Set();
  for (const item of values) {
    output.add(new URL(item.url).origin);
  }
  return output;
}

/** @param {typeof globalThis.fetch} fetchImpl @param {string} url @param {string} origin */
async function fetchPublicState(fetchImpl, url, origin) {
  let response;
  try { response = await fetchImpl(url, { redirect: 'error', headers: { accept: 'application/json' } }); }
  catch (error) { throw new Error(`fetch failed: ${errorMessage(error)}`); }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.url && new URL(response.url).origin !== origin) throw new Error('response origin changed');
  let parsed;
  try { parsed = await response.json(); } catch { throw new Error('response was not valid JSON'); }
  return parseIndexNowStateManifest(parsed, origin);
}

/** @param {import('./indexnow-submit.js').IndexNowTransport} transport @param {string} url @param {string} origin */
async function requestPublicState(transport, url, origin) {
  const response = await transport.request(url, {
    headers: { accept: 'application/json' },
    maxBytes: 2 * 1024 * 1024,
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  let parsed;
  try { parsed = JSON.parse(response.body); } catch { throw new Error('response was not valid JSON'); }
  return parseIndexNowStateManifest(parsed, origin);
}

/** @param {string} a @param {string} b */
function codeUnitCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

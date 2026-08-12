// @ts-check
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  INDEXNOW_ACK_FILENAME,
  INDEXNOW_ACK_VERSION,
  INDEXNOW_PENDING_FILENAME,
  acknowledgeIndexNowOperations,
  normalizeOrigin,
  parseIndexNowAcknowledgment,
  parseIndexNowQueue,
  parseIndexNowStateManifest,
  serializeIndexNowAcknowledgment,
  serializeIndexNowQueue,
  validateRootPath,
} from '../src/build/indexnow-state.js';
import {
  IndexNowInvocationError,
  IndexNowRemoteError,
  errorMessage,
  readJsonFile,
  writePrivateFile,
} from './indexnow-io.js';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_BATCH = 10_000;
const MAX_KEY_RESPONSE = 1_024;
const MAX_STATE_RESPONSE = 2 * 1024 * 1024;

/** @typedef {{ status: number; headers: Record<string, string>; body: string; url: string }} HttpResult */
/** @typedef {{ request: (url: string, options: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number }) => Promise<HttpResult> }} IndexNowTransport */
/**
 * @typedef {{
 *   projectRoot?: string;
 *   acknowledgmentFile?: string;
 *   transport?: IndexNowTransport;
 *   env?: Record<string, string | undefined>;
 *   sleep?: (milliseconds: number) => Promise<void>;
 *   now?: () => number;
 * }} SubmitOptions
 */

/**
 * Submit a private queue. The return value lets the CLI apply the documented
 * strict exit policy without ever formatting a key, POST body, or secret path.
 * @param {string} queueFile
 * @param {SubmitOptions} [options]
 */
export async function submitIndexNow(queueFile, options = {}) {
  const queuePath = resolve(queueFile);
  const root = resolve(options.projectRoot ?? process.cwd());
  const ackPath = resolve(options.acknowledgmentFile ?? join(root, '.astro', 'aeo-cache', 'indexnow', INDEXNOW_ACK_FILENAME));
  const progressPath = join(dirname(queuePath), 'progress-v1.json');
  recoverProgress(progressPath, queuePath, ackPath);
  let queue;
  try { queue = parseIndexNowQueue(readJsonFile(queuePath)); }
  catch (error) {
    if (error instanceof IndexNowInvocationError) throw error;
    throw new IndexNowInvocationError(`invalid IndexNow queue: ${errorMessage(error)}`);
  }
  const acknowledgment = readAcknowledgment(ackPath);
  const transport = options.transport ?? createSafeHttpsTransport();
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  const now = options.now ?? Date.now;

  // Resolve every credential and validate every explicit location before the
  // first POST. A later origin cannot turn a partial submission into an unsafe
  // invocation failure.
  const prepared = queue.origins.filter((originQueue) => originQueue.operations.length > 0).map((originQueue) => {
    const key = resolveKey(originQueue.key, root, env);
    const keyLocation = originQueue.keyLocation === undefined
      ? `/${key}.txt`
      : validateRootPath(originQueue.keyLocation, 'keyLocation');
    return { originQueue, key, keyLocation };
  });

  /** @type {Map<string, import('../src/build/indexnow-state.js').UrlFingerprint[]>} */
  const ackByOrigin = new Map(acknowledgment.origins.map((item) => [item.origin, item.acknowledged]));
  /** @type {string[]} */
  const warnings = [];
  let submitted = 0;
  let strictFailure = false;

  // Verification is a safety gate and completes for every origin before any
  // POST. A key mismatch is an invalid credential (exit 2), while a transient
  // network failure follows strict/non-strict remote failure policy.
  const verified = [];
  for (const item of prepared) {
    const { originQueue, key, keyLocation } = item;
    try {
      if (originQueue.mode === 'public') {
        if (!originQueue.stateUrl) throw new IndexNowInvocationError(`public IndexNow queue for ${originQueue.origin} has no state URL`);
        const stateResponse = await transport.request(originQueue.stateUrl, {
          headers: { accept: 'application/json' },
          maxBytes: MAX_STATE_RESPONSE,
        });
        if (stateResponse.status !== 200) throw new IndexNowRemoteError(`deployed state for ${originQueue.origin} returned HTTP ${stateResponse.status}`);
        let state;
        try { state = parseIndexNowStateManifest(JSON.parse(stateResponse.body), originQueue.origin); }
        catch (error) { throw new IndexNowRemoteError(`deployed state for ${originQueue.origin} is invalid: ${errorMessage(error)}`); }
        if (state.digest !== originQueue.targetDigest) {
          throw new IndexNowRemoteError(`deployed state digest for ${originQueue.origin} does not match the pending queue`);
        }
      }
      const keyUrl = new URL(keyLocation, `${originQueue.origin}/`).href;
      const response = await transport.request(keyUrl, { maxBytes: MAX_KEY_RESPONSE });
      if (response.status !== 200 || response.body.trim() !== key) {
        throw new IndexNowInvocationError(`IndexNow key verification failed for ${originQueue.origin}`);
      }
      verified.push(item);
    } catch (error) {
      if (error instanceof IndexNowInvocationError) throw error;
      const message = `IndexNow verification failed for ${originQueue.origin}: ${safeRemoteMessage(error)}`;
      warnings.push(message);
      if (originQueue.strict) strictFailure = true;
    }
  }

  for (const item of verified) {
    const { originQueue, key, keyLocation } = item;
    let stopOrigin = false;
    while (originQueue.operations.length > 0 && !stopOrigin) {
      const batch = originQueue.operations.slice(0, MAX_BATCH);
      let response;
      try {
        response = await postBatchWithRetry(transport, originQueue.origin, key, keyLocation, batch, sleep, now);
      } catch (error) {
        warnings.push(`IndexNow submission failed for ${originQueue.origin}: ${safeRemoteMessage(error)}`);
        if (originQueue.strict) strictFailure = true;
        break;
      }
      if (response.status !== 200 && response.status !== 202) {
        warnings.push(`IndexNow submission failed for ${originQueue.origin}: HTTP ${response.status}`);
        if (originQueue.strict) strictFailure = true;
        stopOrigin = true;
        continue;
      }

      const currentAck = ackByOrigin.get(originQueue.origin) ?? [];
      ackByOrigin.set(
        originQueue.origin,
        acknowledgeIndexNowOperations(currentAck, batch, originQueue.origin),
      );
      originQueue.operations = originQueue.operations.filter(
        (operation) => !batch.some((success) => success.url === operation.url),
      );
      submitted += batch.length;
      persistProgress(progressPath, queuePath, ackPath, queue, ackByOrigin);
    }
  }

  return {
    submitted,
    pending: queue.origins.reduce((total, item) => total + item.operations.length, 0),
    warnings,
    strictFailure,
    queuePath,
    acknowledgmentPath: ackPath,
  };
}

/**
 * A transport that rejects redirects and DNS rebinding by resolving all target
 * addresses first, rejecting any non-public address, and pinning a vetted
 * address into the HTTPS request lookup callback.
 * @param {{ lookup?: typeof lookup; request?: typeof httpsRequest }} [dependencies]
 * @returns {IndexNowTransport}
 */
export function createSafeHttpsTransport(dependencies = {}) {
  const lookupImpl = dependencies.lookup ?? lookup;
  const requestImpl = dependencies.request ?? httpsRequest;
  return {
    async request(value, options) {
      const url = validateRemoteUrl(value);
      const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
        ? url.hostname.slice(1, -1)
        : url.hostname;
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookupImpl(url.hostname, { all: true, verbatim: true });
      if (addresses.length === 0 || addresses.some((item) => !isPublicIp(item.address))) {
        throw new IndexNowInvocationError('IndexNow remote host does not resolve exclusively to public addresses');
      }
      const pinned = addresses[0];
      return new Promise((resolvePromise, reject) => {
        const request = requestImpl(url, {
          method: options.method ?? 'GET',
          headers: options.headers,
          lookup(_hostname, _options, callback) {
            callback(null, pinned.address, pinned.family);
          },
        }, (response) => {
          /** @type {Buffer[]} */
          const chunks = [];
          let length = 0;
          const limit = options.maxBytes ?? 64 * 1024;
          response.on('data', (chunk) => {
            length += chunk.length;
            if (length > limit) {
              request.destroy(new IndexNowInvocationError('IndexNow response exceeded its safe size limit'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolvePromise({
            status: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
            body: Buffer.concat(chunks).toString('utf8'),
            url: url.href,
          }));
        });
        request.on('error', reject);
        request.setTimeout(15_000, () => request.destroy(new Error('request timed out')));
        if (options.body !== undefined) request.end(options.body);
        else request.end();
      });
    },
  };
}

/**
 * @param {IndexNowTransport} transport
 * @param {string} origin
 * @param {string} key
 * @param {string} keyLocation
 * @param {import('../src/build/indexnow-state.js').IndexNowOperation[]} batch
 * @param {(milliseconds: number) => Promise<void>} sleep
 * @param {() => number} now
 */
async function postBatchWithRetry(transport, origin, key, keyLocation, batch, sleep, now) {
  const urlList = batch.map((item) => item.url);
  const body = JSON.stringify({
    host: new URL(origin).hostname,
    key,
    keyLocation: new URL(keyLocation, `${origin}/`).href,
    urlList,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await transport.request(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body,
      });
      if (response.status === 200 || response.status === 202) return response;
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === 2) return response;
      await sleep(retryDelay(response.headers['retry-after'], attempt, now()));
    } catch (error) {
      if (error instanceof IndexNowInvocationError) throw error;
      if (attempt === 2) throw new IndexNowRemoteError('network request failed', error);
      await sleep(retryDelay(undefined, attempt, now()));
    }
  }
  throw new IndexNowRemoteError('submission attempts exhausted');
}

/** @param {string | undefined} header @param {number} attempt @param {number} now */
export function retryDelay(header, attempt, now) {
  let milliseconds;
  if (header !== undefined) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) milliseconds = seconds * 1_000;
    else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) milliseconds = Math.max(0, date - now);
    }
  }
  return Math.min(30_000, milliseconds ?? (attempt === 0 ? 1_000 : 2_000));
}

/** @param {import('../src/build/indexnow-state.js').IndexNowKeySource} source @param {string} root @param {Record<string, string | undefined>} env */
function resolveKey(source, root, env) {
  let key;
  if (source.source === 'env') key = env[source.name ?? 'ASTRO_AEO_INDEXNOW_KEY'];
  else {
    const path = isAbsolute(source.path) ? source.path : resolve(root, source.path);
    try { key = readFileSync(path, 'utf8').trim(); }
    catch { throw new IndexNowInvocationError('cannot read the configured IndexNow secret file'); }
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,128}$/u.test(key)) {
    throw new IndexNowInvocationError('IndexNow credential must match [A-Za-z0-9-]{8,128}');
  }
  return key;
}

/** @param {string} path */
function readAcknowledgment(path) {
  if (!existsSync(path)) {
    return /** @type {import('../src/build/indexnow-state.js').IndexNowAcknowledgmentV1} */ ({ version: 1, origins: [] });
  }
  try { return parseIndexNowAcknowledgment(readJsonFile(path)); }
  catch (error) {
    throw new IndexNowInvocationError(`invalid IndexNow acknowledgment ledger: ${errorMessage(error)}`);
  }
}

/**
 * @param {string} progressPath
 * @param {string} queuePath
 * @param {string} ackPath
 * @param {import('../src/build/indexnow-state.js').IndexNowQueueV1} queue
 * @param {Map<string, import('../src/build/indexnow-state.js').UrlFingerprint[]>} ackByOrigin
 */
function persistProgress(progressPath, queuePath, ackPath, queue, ackByOrigin) {
  /** @type {import('../src/build/indexnow-state.js').IndexNowAcknowledgmentV1} */
  const acknowledgment = {
    version: 1,
    origins: [...ackByOrigin.entries()]
      .map(([origin, acknowledged]) => ({ origin, acknowledged }))
      .sort((a, b) => a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0),
  };
  // The journal makes the pair crash-consistent: it is the atomic commit record,
  // and the next submit finishes both idempotent projections before reading.
  writePrivateFile(progressPath, `${JSON.stringify({
    version: 1,
    acknowledgment,
    queue,
  }, null, 2)}\n`);
  writePrivateFile(ackPath, serializeIndexNowAcknowledgment(acknowledgment));
  writePrivateFile(queuePath, serializeIndexNowQueue(queue));
  try { unlinkSync(progressPath); } catch {}
}

/** @param {string} progressPath @param {string} queuePath @param {string} ackPath */
function recoverProgress(progressPath, queuePath, ackPath) {
  if (!existsSync(progressPath)) return;
  let parsed;
  try { parsed = readJsonFile(progressPath); }
  catch (error) { throw new IndexNowInvocationError(`invalid IndexNow progress journal: ${errorMessage(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1) {
    throw new IndexNowInvocationError('invalid IndexNow progress journal');
  }
  let queue;
  let acknowledgment;
  try {
    queue = parseIndexNowQueue(parsed.queue);
    acknowledgment = parseIndexNowAcknowledgment(parsed.acknowledgment);
  } catch (error) {
    throw new IndexNowInvocationError(`invalid IndexNow progress journal: ${errorMessage(error)}`);
  }
  writePrivateFile(ackPath, serializeIndexNowAcknowledgment(acknowledgment));
  writePrivateFile(queuePath, serializeIndexNowQueue(queue));
  try { unlinkSync(progressPath); } catch {}
}

/** @param {string} value */
function validateRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new IndexNowInvocationError('IndexNow remote URL is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new IndexNowInvocationError('IndexNow remote URL must use credential-free HTTPS on port 443');
  }
  return url;
}

/** @param {string} address */
export function isPublicIp(address) {
  let value = address.toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  const family = isIP(value);
  if (family === 4) {
    const numeric = ipv4Number(value);
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, bits]) => ipv4InCidr(numeric, ipv4Number(/** @type {string} */ (network)), /** @type {number} */ (bits)));
  }
  if (family === 6) {
    const numeric = ipv6Number(value);
    if (numeric === null) return false;
    return ![
      ['::', 128],
      ['::1', 128],
      ['::', 96],
      ['64:ff9b::', 96],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001::', 23],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
      ['5f00::', 16],
      ['fc00::', 7],
      ['fe80::', 10],
      ['fec0::', 10],
      ['ff00::', 8],
    ].some(([network, bits]) => ipv6InCidr(numeric, /** @type {string} */ (network), /** @type {number} */ (bits)));
  }
  return false;
}

/** @param {string} value */
function ipv4Number(value) {
  return value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

/** @param {number} value @param {number} network @param {number} bits */
function ipv4InCidr(value, network, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}

/** @param {bigint} value @param {string} network @param {number} bits */
function ipv6InCidr(value, network, bits) {
  const parsed = ipv6Number(network);
  if (parsed === null) return true;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (parsed >> shift);
}

/** @param {string} address @returns {bigint | null} */
function ipv6Number(address) {
  let value = address;
  if (value.includes('.')) {
    const split = value.lastIndexOf(':');
    const ipv4 = value.slice(split + 1);
    if (isIP(ipv4) !== 4) return null;
    const numeric = ipv4Number(ipv4);
    value = `${value.slice(0, split)}:${(numeric >>> 16).toString(16)}:${(numeric & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/u.test(word))) return null;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

/** @param {import('node:http').IncomingHttpHeaders} headers */
function normalizeHeaders(headers) {
  /** @type {Record<string, string>} */
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) output[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return output;
}

/** @param {unknown} error */
function safeRemoteMessage(error) {
  if (error instanceof IndexNowRemoteError || error instanceof IndexNowInvocationError) return error.message;
  return 'remote request failed';
}

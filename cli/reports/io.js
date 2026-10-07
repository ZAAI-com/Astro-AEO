// @ts-check
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_ROWS = 100000;
export class ReportInvocationError extends Error {}

/** Lexical containment, including the parent itself. A Windows path on another
 * drive is never within.
 * @param {string} parent @param {string} child */
function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

/** Check each component from the trusted root down, not only its final canonical
 * target. The root defaults to the working directory for paths inside it, else
 * the file's directory. Folders above the root belong to the caller's
 * environment, such as a symlinked home directory, and are not inspected.
 * @param {string} file @param {string} [root] @param {boolean} [allowMissing] */
export async function safeFile(file, root, allowMissing = false) {
  const target = resolve(file);
  const cwd = resolve(process.cwd());
  const anchor = root ? resolve(root) : isWithin(cwd, target) ? cwd : dirname(target);
  if (!isWithin(anchor, target)) throw new ReportInvocationError('Report input escapes its root.');
  const ancestors = [];
  for (let part = target;; part = dirname(part)) {
    ancestors.push(part); if (part === anchor || part === dirname(part)) break;
  }
  // Top down catches a linked parent even when its requested child is missing.
  for (const part of ancestors.reverse()) {
    const stat = await lstat(part).catch((error) => {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw new ReportInvocationError('Cannot read report input.');
    });
    if (!stat) continue;
    const systemAlias = stat.isSymbolicLink() && part !== target && ['/var','/tmp'].includes(part) &&
      await realpath(part) === '/private' + part;
    if (stat.isSymbolicLink() && !systemAlias) throw new ReportInvocationError('Report files and project directories must not be symlinks.');
    if (part !== target && !stat.isDirectory() && !systemAlias) throw new ReportInvocationError('Report input has an unsafe parent.');
    if (part === target && !stat.isFile()) throw new ReportInvocationError('Report input must be a regular file.');
  }
  return target;
}

/** @param {string} file @param {string} [root] @param {{ remaining: number }} [budget] */
export async function readText(file, root, budget = { remaining: MAX_BYTES }) {
  const target = await safeFile(file, root);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > budget.remaining) throw new ReportInvocationError('Report input exceeds the byte limit or is not a regular file.');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > budget.remaining) throw new ReportInvocationError('Report input exceeds the byte limit.');
      chunks.push(chunk);
    }
    budget.remaining -= bytes;
    return decodeUtf8(Buffer.concat(chunks));
  } finally { await handle.close(); }
}

/** @param {string} text */
export function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new ReportInvocationError('Report input is not valid JSON.'); }
}
/** @param {string} file @param {string} [root] */
export async function readJson(file, root) { return parseJson(await readText(file, root)); }
/** @param {string} file @param {string} [root] */
export async function optionalJson(file, root) {
  await safeFile(file, root, true);
  try { await lstat(file); } catch (error) { if (/** @type {any} */ (error).code === 'ENOENT') return null; throw error; }
  return readJson(file, root);
}

/** No parser is fed an unbounded stream. @param {AsyncIterable<Uint8Array|string>} stream */
export async function readStream(stream) {
  const chunks = []; let bytes = 0;
  for await (const raw of stream) {
    const chunk = Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new ReportInvocationError('Report input exceeds the byte limit.');
    chunks.push(chunk);
  }
  return decodeUtf8(Buffer.concat(chunks));
}

/** Explicit URL baseline only: no credentials, redirects, config execution or remote references.
 * @param {string} input @param {typeof fetch} [fetcher] */
export async function readBaseline(input, fetcher = fetch) {
  if (!/^https?:\/\//i.test(input)) return readJson(resolve(input));
  let url;
  try { url = new URL(input); } catch { throw new ReportInvocationError('Invalid baseline URL.'); }
  if (url.username || url.password || url.hash) throw new ReportInvocationError('Baseline URL must not contain credentials or a fragment.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetcher(url, { redirect: 'manual', signal: controller.signal });
    if (!response.ok || !response.body) throw new ReportInvocationError('Baseline URL did not return a usable response.');
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) { await response.body.cancel(); throw new ReportInvocationError('Report input exceeds the byte limit.'); }
    return parseJson(await readStream(/** @type {any} */ (response.body)));
  } catch (error) {
    if (error instanceof ReportInvocationError) throw error;
    throw new ReportInvocationError('Cannot fetch baseline URL.');
  } finally { clearTimeout(timer); }
}

/** Explicit exports only, sibling atomic private writes, no overwrite through symlinks.
 * @param {string} file @param {string} text */
export async function writeOutput(file, text) {
  const target = resolve(file), parent = dirname(target);
  let anchor = parent;
  while (true) {
    try { await lstat(anchor); break; } catch (error) {
      if (/** @type {any} */ (error).code !== 'ENOENT') throw new ReportInvocationError('Cannot create report output.');
      const next = dirname(anchor); if (next === anchor) throw new ReportInvocationError('Cannot create report output.'); anchor = next;
    }
  }
  if ((await lstat(anchor)).isSymbolicLink()) throw new ReportInvocationError('Report output parent must not be a symlink.');
  const canonical = await realpath(anchor);
  // Reject a linked ancestor below the caller's filesystem alias.
  const cwd = resolve(process.cwd());
  await safeFile(target, isWithin(cwd, target) ? cwd : anchor, true);
  await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  if (parentReal !== canonical && !parentReal.startsWith(canonical + sep)) throw new ReportInvocationError('Unsafe report output parent.');
  const temporary = target + '.' + randomBytes(8).toString('hex') + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); await rename(temporary, target); }
  catch { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw new ReportInvocationError('Cannot write report output.'); }
}

/** Reject malformed bytes, rather than silently changing data before hashing.
 * @param {Uint8Array} bytes */
function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { throw new ReportInvocationError('Report input is not valid UTF-8.'); }
}

// @ts-check
import { join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { MAX_BYTES, MAX_ROWS, readText, optionalJson, safeFile, ReportInvocationError } from './io.js';
import { assertContract, assertSnapshot } from './contracts.js';
import { readManifest } from './inspect.js';
import { evidenceHash } from '../../src/build/evidence.js';
import { isRagRecord, planRagRecords } from '../../src/core/rag.js';
import { inspectRootPathname, matchPath } from '../../src/core/match.js';
import { pagePathForMdPath } from '../../src/core/page-model.js';
import { BUILTIN_TOKENIZER_IDENTITY, countApproximateTokens } from '../../src/core/corpus-tokenizer.js';

/** @param {string} root @param {{dist:string;manifest?:string;origin?:string;base?:string;maxTokens?:number;pages?:string[]}} options
 * @returns {Promise<import('../../src/index.js').RagReportV1>} */
export async function ragReport(root, options) {
  const cache = join(root,'.astro','aeo-cache');
  const snapshot = await optionalJson(join(cache,'pages-v1.json'),root);
  const warnings = [];
  const digestOk = snapshot ? assertSnapshot(snapshot) : false;
  if (snapshot && !digestOk) warnings.push('Snapshot digest mismatch.');
  const index = await optionalJson(join(cache,'rag-v1','index-v1.json'),root);
  const budget = { remaining: MAX_BYTES };
  /** @type {import('../../src/index.js').RagRecordV1[]} */
  let records = [];
  if (index) {
    assertContract(index,'rag-index-v1');
    if (snapshot && snapshot.buildDigest !== index.buildDigest) warnings.push('RAG and snapshot digest mismatch.');
    const seen = new Set(), files = new Set();
    for (const file of index.files) {
      if (files.has(file.file)) throw new ReportInvocationError('Duplicate RAG index file.');
      files.add(file.file);
      const text = await readText(join(cache,'rag-v1',file.file),root,budget);
      if (evidenceHash(text) !== file.hash) throw new ReportInvocationError('Private RAG file hash mismatch.');
      const parsed = [];
      for (const line of text.split('\n').filter(Boolean)) {
        let record;
        try { record = JSON.parse(line); } catch { throw new ReportInvocationError('Invalid private RAG JSONL.'); }
        if (!isRagRecord(record) || seen.has(record.id) || record.metadata.locale !== file.locale || record.metadata.contentVersion !== file.contentVersion ||
          evidenceHash(record.text) !== record.hash) throw new ReportInvocationError('Invalid or inconsistent private RAG record.');
        if (record.tokenizer.name === BUILTIN_TOKENIZER_IDENTITY.name && record.tokenizer.version === BUILTIN_TOKENIZER_IDENTITY.version && record.tokenizer.approximate === BUILTIN_TOKENIZER_IDENTITY.approximate &&
          record.tokenCount !== countApproximateTokens(record.text)) throw new ReportInvocationError('Private RAG approximate token count mismatch.');
        publicUrl(record.metadata.url);
        const identity = {url:record.metadata.url,pathname:inspectRootPathname(record.metadata.pathname)?.decoded,
          locale:record.metadata.locale,version:record.metadata.contentVersion};
        if (record.pageId !== 'page:' + evidenceHash(identity).slice(7)) throw new ReportInvocationError('Private RAG stable identity mismatch.');
        seen.add(record.id); parsed.push(record);
        if (seen.size > MAX_ROWS) throw new ReportInvocationError('RAG input exceeds the record limit.');
      }
      if (parsed.length !== file.records) throw new ReportInvocationError('Private RAG index count mismatch.');
      records.push(...parsed);
    }
    const pages = new Map(records.filter((r) => r.kind === 'page').map((r) => [r.pageId,r.hash]));
    for (const record of records) {
      const hash = pages.get(record.pageId);
      if (hash && hash !== record.pageHash || record.kind === 'page' && record.hash !== record.pageHash) throw new ReportInvocationError('Private RAG page hash mismatch.');
    }
    if (snapshot?.ragHash && evidenceHash([...records].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) !== snapshot.ragHash) warnings.push('RAG content hash does not match snapshot evidence.');
    if (index.buildTimeIncomplete || !index.inventoryComplete) warnings.push('Build-time export is incomplete: runtime-owned or unavailable pages are not included.');
    if (options.maxTokens !== undefined) warnings.push('Private RAG records retain their build-time chunk budget; --max-tokens applies only to companion reconstruction.');
    return {version:1,type:'rag',source:'private',buildDigest:index.buildDigest,inventoryComplete:index.inventoryComplete,
      buildTimeIncomplete:index.buildTimeIncomplete || !index.inventoryComplete,warnings,records:select(records,options.pages)};
  }

  const manifestFile = options.manifest ?? (await optionalJson(join(options.dist,'llms','manifest.json'),options.dist)
    ? join(options.dist,'llms','manifest.json') : undefined);
  const manifest = manifestFile ? await readManifest(manifestFile) : null;
  let incomplete = !snapshot || !snapshot.inventoryComplete || !digestOk;
  if (!manifest) warnings.push('Companion discovery has no manifest: locale, version and index eligibility may be unavailable.');
  const base = manifest?.base ?? options.base ?? '/';
  if (!inspectRootPathname(base)) throw new ReportInvocationError('Invalid build base.');
  const basePrefix = base === '/' ? '' : base.replace(/\/$/,'');
  /** @type {any[]} */
  const pages = [];
  const missing = [];
  /** @type {Array<{file:string;descriptor:any}>} */
  const inputs = [];
  if (manifest) {
    for (const descriptor of manifest.pages) {
      if (descriptor.markdownUrl === null) continue;
      const pathname = new URL(descriptor.markdownUrl).pathname;
      const relativePath = basePrefix ? pathname.startsWith(basePrefix + '/') ? pathname.slice(basePrefix.length) : null : pathname;
      const decoded = relativePath && inspectRootPathname(relativePath)?.decoded;
      if (!decoded || !decoded.endsWith('.md')) throw new ReportInvocationError('Manifest companion is outside the build base.');
      inputs.push({file:join(options.dist,decoded.slice(1)),descriptor});
    }
  } else {
    await safeDirectory(options.dist);
    let visited = 0;
    /** @param {string} directory @param {number} depth */
    const discover = async (directory,depth) => {
      if (depth > 32) throw new ReportInvocationError('Companion directory exceeds the depth limit.');
      for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (++visited > MAX_ROWS) throw new ReportInvocationError('Companion discovery exceeds the entry limit.');
        if (entry.name.startsWith('.') || ['_astro','node_modules'].includes(entry.name)) continue;
        if (entry.isSymbolicLink()) throw new ReportInvocationError('Companion discovery refuses symlinks.');
        const file = join(directory,entry.name);
        if (entry.isDirectory()) await discover(file,depth+1);
        else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('llms')) inputs.push({file,descriptor:null});
      }
    };
    await discover(options.dist,0);
  }
  for (const {file,descriptor} of inputs) {
    // Missing files disclose incomplete export, but linked/unsafe files fail closed.
    let body;
    try { body = await readText(file,options.dist,budget); }
    catch (error) {
      const exists = await optionalJsonExistence(file,options.dist);
      if (!exists) { missing.push(file); continue; }
      throw error;
    }
    const decoded = decodeCompanion(body);
    const physical = file.slice(resolve(options.dist).length).replaceAll('\\','/');
    const fallbackPath = pagePathForMdPath(physical);
    const pathname = descriptor?.id ?? fallbackPath;
    if (typeof pathname !== 'string' || !inspectRootPathname(pathname)) throw new ReportInvocationError('Companion page identity is unsafe.');
    const rawUrl = descriptor?.canonicalUrl ?? decoded.url ??
      (options.origin ? new URL(basePrefix + pathname, publicOrigin(options.origin)).href : null);
    if (!rawUrl) throw new ReportInvocationError('Companion export needs --origin or published URL frontmatter/manifest.');
    const canonicalUrl = publicUrl(rawUrl);
    if (descriptor?.hash && evidenceHash(body.replace(/\r\n?/g,'\n')) !== descriptor.hash) warnings.push('A companion differs from its manifest content hash.');
    pages.push({pathname,url:canonicalUrl,canonicalUrl,markdown:decoded.text,title:decoded.title ?? '',
      locale:descriptor?.locale ?? null,language:descriptor?.language ?? null,
      version:descriptor?.version ?? null,versionGroup:descriptor?.versionGroup ?? null,section:descriptor?.section ?? null});
  }
  if (missing.length) { incomplete = true; warnings.push('Some manifest companions are unavailable in the build output.'); }
  if (incomplete) warnings.push('Build-time export is incomplete or its full runtime inventory cannot be established.');
  warnings.push('Companion reconstruction cannot recover private index directives or plugin drop decisions.');
  warnings.push('Companion reconstruction uses the disclosed built-in approximation, without loading consumer tokenizers or hooks.');
  const plan = await planRagRecords(pages,{maxTokens:options.maxTokens ?? 512,tokenizer:BUILTIN_TOKENIZER_IDENTITY,count:async (text) => countApproximateTokens(text)});
  if (plan.diagnostics.length) warnings.push('Oversized indivisible Markdown units were retained whole.');
  return {version:1,type:'rag',source:'companions',buildDigest:snapshot?.buildDigest ?? null,inventoryComplete:!incomplete,
    buildTimeIncomplete:incomplete,warnings:[...new Set(warnings)],records:select(plan.records,options.pages)};
}
/** @param {import('../../src/index.js').RagRecordV1[]} records @param {string[]|undefined} patterns */
function select(records,patterns) { return records.filter((record) => !patterns?.length || patterns.some((pattern) => matchPath(record.metadata.pathname,pattern))); }
/** Recognize only the integration's generated scalar wrapper. Never parse/execute MDX or YAML tags.
 * @param {string} input */
export function decodeCompanion(input) {
  let text = input.replace(/\r\n?/g,'\n'), title, url;
  const match = /^---\n((?:(?:title|url|description|lastModified): [^\n]*\n)+)---\n\n/.exec(text);
  if (match) {
    const fields = Object.fromEntries(match[1].trimEnd().split('\n').map((line) => { const at = line.indexOf(': '); return [line.slice(0,at),line.slice(at+2)]; }));
    if (fields.title?.startsWith('"')) { try { title = JSON.parse(fields.title); } catch { throw new ReportInvocationError('Invalid companion title frontmatter.'); } }
    if (title !== undefined && typeof title !== 'string') throw new ReportInvocationError('Invalid companion title frontmatter.');
    url = fields.url;
    text = text.slice(match[0].length);
  }
  return {text,title,url};
}
/** @param {string} raw */
function publicUrl(raw) {
  let url; try { url = new URL(raw); } catch { throw new ReportInvocationError('Invalid companion canonical URL.'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ReportInvocationError('Unsafe companion canonical URL.');
  return url.href;
}
/** @param {string} raw */
function publicOrigin(raw) { const url = new URL(publicUrl(raw)); if (url.pathname !== '/') throw new ReportInvocationError('--origin must be an origin without a path.'); return url.origin; }
/** @param {string} file @param {string} root */
async function optionalJsonExistence(file,root) {
  await safeFile(file,root,true);
  const { lstat } = await import('node:fs/promises');
  try { await lstat(file); return true; } catch (error) { if (/** @type {any} */ (error).code === 'ENOENT') return false; throw error; }
}
/** @param {string} directory */
async function safeDirectory(directory) {
  const { lstat } = await import('node:fs/promises');
  const stat = await lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new ReportInvocationError('Build directory must be an unlinked directory.');
}

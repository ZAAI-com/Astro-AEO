// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { validateDist } from '../../cli/validate.js';
import { basicManifestShape } from '../../cli/validate-corpus.js';
import { evidenceHash } from '../build/evidence.js';
import { diagnosticsManifestPath, sanitizeDiagnostics } from '../build/diagnostics.js';
import { isSafeOutputPath, isUnlinkedDirectory, matchesOutputRootId, ownershipManifestPath, readOwnershipManifest } from '../build/ownership.js';
import { isRedirectStub } from '../core/page-meta.js';
import { mdPathnameFor } from '../core/page-model.js';
import { extractPageFacts } from './facts.js';
import { createFinding, fromDiagnostic, fromLegacyFinding } from './finding.js';
import { auditApplicability } from './applicability.js';
import { auditPages } from './site-rules.js';

/**
 * @typedef {import('./facts.js').PageFacts} PageFacts
 * @typedef {import('../index.js').Finding} Finding
 */

/** The requested build root is reached through a symbolic link. */
export class UnsafeAuditRootError extends Error {}

/**
 * Audit a built output directory without touching the network. The private
 * build manifests under `.astro/aeo-cache` are read when they exist; they are
 * already sanitized, and nothing here reports an absolute path or a source body.
 *
 * @param {string} distDir
 * @param {{ base?: string; projectRoot?: string; siteUrl?: string; heuristics?: boolean; schemaTarget?: 'schema' | 'google'; now?: Date }} [options]
 * @returns {{ findings: Finding[]; pagesChecked: number; languageCount: number; applicability: import('../index.js').AuditApplicability[] }}
 */
export function auditDist(distDir, options = {}) {
  const root = resolve(distDir);
  if (existsSync(root) && !isUnlinkedDirectory(root)) {
    throw new UnsafeAuditRootError('build directory is reached through a symbolic link');
  }
  const legacy = validateDist(root, { base: options.base });
  /** @type {Finding[]} */
  const findings = [...legacy.errors, ...legacy.warnings].map(fromLegacyFinding);
  if (legacy.errors.some((finding) => finding.code === 'no-dist')) {
    return { findings, pagesChecked: 0, languageCount: 0,applicability:auditApplicability([],{mode:'offline'}) };
  }

  const base = normalizeBase(options.base);
  const origin = localOrigin(root, options.siteUrl);
  const pages = readPages(root, origin, base, options.heuristics);
  const projectRoot = options.projectRoot ?? resolve(root,'..');
  const ownership = safeOwnership(projectRoot);
  const privateEvidence = evidenceFindings(projectRoot,root,ownership);
  const inventoryComplete = privateEvidence.length === 0 && ownership !== null && matchesOutputRootId(ownership.outputRootId,root) && completeSnapshot(projectRoot) && !ownership.artifacts.some((/** @type {any} */ entry) => entry.status === 'runtime');
  findings.push(...auditPages(pages, {
    inventoryComplete,
    heuristics: options.heuristics,
    schemaTarget: options.schemaTarget,
    now: options.now,
    links: createResolver(root, base, pages, origin),
    ...(origin ? { siteUrl:origin + base + '/' } : {}),
  }));
  findings.push(...manifestFindings(projectRoot),...privateEvidence);

  const languages = new Set(pages.map((page) => page.language?.toLowerCase().split('-')[0]).filter(Boolean));
  return { findings: unique(findings), pagesChecked: pages.length, languageCount: languages.size,
    applicability:auditApplicability(pages,{mode:'offline',inventoryComplete,discoveryObserved:true,
      corpusObserved:existsSync(join(root,'llms/manifest.json')),buildEvidenceObserved:ownership !== null && matchesOutputRootId(ownership.outputRootId,root)}) };
}

/** @param {string} root @param {string | undefined} origin @param {string} base @param {boolean | undefined} heuristics @returns {PageFacts[]} */
function readPages(root, origin, base, heuristics) {
  /** @type {PageFacts[]} */
  const pages = [];
  for (const path of walk(root)) {
    if (!path.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    if (isRedirectStub(html)) continue;
    const file = `/${relative(root, path).split(sep).join('/')}`;
    const pathname = pageUrl(file);
    const companion = join(root, mdPathnameFor(pathname.replace(/\/$/, '') || '/'));
    pages.push(extractPageFacts(html, {
      url: pathname,
      file,
      heuristics,
      ...(origin ? { documentUrl: `${origin}${base}${pathname}` } : {}),
      ...(isSafeOutputPath(root, companion) && existsSync(companion) && lstatSync(companion).isFile()
        ? { markdown: readFileSync(companion, 'utf8'), markdownFile:'/' + relative(root,companion).split(sep).join('/') } : {}),
    }));
  }
  const path = join(root,'llms/manifest.json');
  if (isSafeOutputPath(root,path)) {
    try {
      const manifest = JSON.parse(readFileSync(path,'utf8'));
      if (basicManifestShape(manifest)) {
        const records = new Map(manifest.pages.map((/** @type {any} */ record) => [record.id,record]));
        for (const page of pages) {
          const bare = page.url.replace(/\/$/,'') || '/';
          const record = /** @type {any} */ (records.get(bare));
          if (!record) continue;
          if (typeof record.version === 'string') page.version = record.version;
          if (typeof record.locale === 'string') page.locale = record.locale;
          if (Array.isArray(record.versionAlternates)) {
            page.versionAlternates = record.versionAlternates.filter((/** @type {any} */ alternate) =>
              alternate && alternate.kind === 'version' && typeof alternate.version === 'string' &&
              typeof alternate.url === 'string' && /^https?:\/\//.test(alternate.url));
          }
        }
      }
    } catch { /* Invalid manifests already produce validator findings. */ }
  }
  return pages;
}

/** `/blog/index.html` is `/blog/`, `/about.html` is `/about`. @param {string} file */
function pageUrl(file) {
  if (file.endsWith('/index.html')) return file.slice(0, -'index.html'.length);
  return file.slice(0, -'.html'.length);
}

/**
 * @param {string} root
 * @param {string} base
 * @param {PageFacts[]} pages
 * @param {string | undefined} origin
 * @returns {import('./site-rules.js').LinkResolver}
 */
function createResolver(root, base, pages, origin) {
  /** @type {Map<string, PageFacts>} */
  const byPath = new Map();
  for (const page of pages) {
    const bare = page.url.length > 1 && page.url.endsWith('/') ? page.url.slice(0, -1) : page.url;
    for (const key of [page.url, bare, `${bare}/`, page.file ?? page.url]) byPath.set(key, page);
  }
  return {
    resolve(from, href) {
      if (!origin && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
      let url;
      try {
        url = new URL(href, `${origin ?? 'http://audit.invalid'}${base}${from.url}`);
      } catch {
        return null;
      }
      if (url.origin !== (origin ?? 'http://audit.invalid') || !/^https?:$/.test(url.protocol)) return null;
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return null;
      }
      if (base) {
        // A path outside the base belongs to another deployment: not checkable here.
        if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
        pathname = pathname.slice(base.length) || '/';
      }
      let fragment = url.hash.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // Keep the raw fragment: it simply will not match an id.
      }
      return { key: pathname, fragment };
    },
    lookup(key) {
      const page = byPath.get(key);
      if (page) return page;
      const target = resolve(root, `.${key}`);
      if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined;
      return existsSync(target) ? null : undefined;
    },
  };
}

/** Only build metadata or an explicit caller option establishes the local origin.
 * @param {string} root @param {string | undefined} siteUrl
 */
function localOrigin(root, siteUrl) {
  if (siteUrl !== undefined) return httpOrigin(siteUrl);
  const manifest = readJson('llms/manifest.json');
  if (basicManifestShape(manifest)) return httpOrigin(manifest.origin);
  return httpOrigin(readJson('.well-known/domain-profile.json')?.url);

  /** @param {string} name */
  function readJson(name) {
    const path = join(root, name);
    try {
      return isSafeOutputPath(root, path) && lstatSync(path).isFile()
        ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** @param {unknown} value */
function httpOrigin(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} projectRoot @returns {Finding[]} */
function manifestFindings(projectRoot) {
  /** @type {Finding[]} */
  const findings = [];
  try {
    const path = diagnosticsManifestPath(projectRoot);
    if (!safePrivateFile(projectRoot,path)) throw new Error('Unsafe evidence');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest?.version === 1) {
      findings.push(...sanitizeDiagnostics(manifest.diagnostics).map(fromDiagnostic));
      for (const page of Array.isArray(manifest.pages) ? manifest.pages : []) {
        findings.push(...sanitizeDiagnostics(page?.diagnostics).map(fromDiagnostic));
      }
    }
  } catch {
    // No manifest, or one this version cannot read: the dist checks still stand.
  }
  // The ledger restates arbitration results the diagnostics usually carry already.
  const reported = new Set(findings.map((finding) => `${finding.ruleId} ${finding.url ?? ''}`));
  const ownership = safeOwnership(projectRoot);
  for (const artifact of ownership?.artifacts ?? []) {
    const ruleId = artifact.status === 'conflict' ? 'artifact-generated-conflict' : 'artifact-group-skipped';
    if (reported.has(`${ruleId} ${artifact.pathname}`)) continue;
    if (artifact.status === 'conflict') {
      findings.push(createFinding({
        ruleId: 'artifact-generated-conflict',
        severity: 'error',
        message: `more than one generator claimed ${artifact.pathname}; nothing was written`,
        url: artifact.pathname,
      }));
    } else if (artifact.status === 'group-skipped') {
      findings.push(createFinding({
        ruleId: 'artifact-group-skipped',
        severity: 'warning',
        message: `${artifact.pathname} was skipped with its artifact group ${artifact.group}`,
        url: artifact.pathname,
      }));
    }
  }
  return findings;
}

/** Drop exact repeats: the manifests can restate what the dist already shows. */
function unique(/** @type {Finding[]} */ findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.ruleId, finding.url, finding.file, finding.evidence, finding.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sorted, symlink-free walk so page order never depends on the filesystem. @param {string} directory @returns {string[]} */
function walk(directory) {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return [];
    return stats.isDirectory() ? walk(path) : [path];
  });
}

/** @param {string | undefined} base */
function normalizeBase(base) {
  const trimmed = (base ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** Private evidence must not escape through a symlink or consume unbounded input.
 * @param {string} root @param {string} path */
function safePrivateFile(root,path) {
  try { return isUnlinkedDirectory(root) && isSafeOutputPath(root,path) && lstatSync(path).isFile() && lstatSync(path).size <= 16*1024*1024; }
  catch { return false; }
}
/** @param {string} root */
function safeOwnership(root) {
  return safePrivateFile(root,ownershipManifestPath(root)) ? readOwnershipManifest(root) : null;
}

/** Digest mismatch and incomplete inventories cannot establish full-site coverage.
 * @param {string} root */
function completeSnapshot(root) {
  const path = join(root,'.astro','aeo-cache','pages-v1.json');
  if (!safePrivateFile(root,path)) return false;
  try {
    const snapshot = JSON.parse(readFileSync(path,'utf8'));
    const {buildDigest,...content} = snapshot;
    return snapshot.version === 1 && snapshot.inventoryComplete === true && Array.isArray(snapshot.pages) &&
      Array.isArray(snapshot.artifacts) && buildDigest === evidenceHash(content);
  } catch { return false; }
}

/** Compare independent evidence identities, not raw diagnostics or source bodies.
 * @param {string} project @param {string} output @param {any|null} ownership
 * @returns {Finding[]} */
function evidenceFindings(project,output,ownership) {
  const directory = join(project,'.astro','aeo-cache');
  const read = (/** @type {string} */ name) => {
    const path = join(directory,name);
    try {return safePrivateFile(project,path) ? JSON.parse(readFileSync(path,'utf8')) : undefined;}
    catch {return undefined;}
  };
  const snapshot = read('pages-v1.json'), trace = read('trace-v1.json'), deployment = read('deployment-v1.json');
  let mismatch = !!ownership && !matchesOutputRootId(ownership.outputRootId,output);
  if (snapshot?.version === 1) {
    const {buildDigest,...content} = snapshot;
    mismatch ||= buildDigest !== evidenceHash(content) || !!trace && trace.buildDigest !== buildDigest;
    if (ownership && Array.isArray(snapshot.artifacts)) {
      const ledger = new Map(ownership.artifacts.map((/** @type {any} */ item) => [item.pathname,item]));
      mismatch ||= snapshot.artifacts.length !== ownership.artifacts.length || snapshot.artifacts.some((/** @type {any} */ item) => {
        const record = /** @type {any} */ (ledger.get(item?.pathname));
        return !record || record.status !== item.status || item.owner !== null && (record.owner?.name ?? null) !== item.owner ||
          (record.representation?.etag ?? null) !== item.etag || (record.representation?.byteLength ?? null) !== item.byteLength;
      });
    }
  }
  if (deployment?.version === 1 && ownership) {
    const text = ownership.artifacts.map((/** @type {any} */ item) => item.status + ' ' + item.pathname).sort().join('\n');
    mismatch ||= deployment.ownershipDigest !== 'sha256:' + createHash('sha256').update(text).digest('hex');
  }
  return mismatch ? [createFinding({ruleId:'audit-evidence-mismatch',severity:'warning',message:'Private build, deployment or ownership identities do not agree; evidence coverage is incomplete.'})] : [];
}

// @ts-check
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { validateDist } from '../../cli/validate.js';
import { diagnosticsManifestPath, sanitizeDiagnostics } from '../build/diagnostics.js';
import { readOwnershipManifest } from '../build/ownership.js';
import { isRedirectStub } from '../core/page-meta.js';
import { extractPageFacts } from './facts.js';
import { createFinding, fromDiagnostic, fromLegacyFinding } from './finding.js';
import { auditPages } from './site-rules.js';

/**
 * @typedef {import('./facts.js').PageFacts} PageFacts
 * @typedef {import('../index.js').Finding} Finding
 */

/**
 * Audit a built output directory without touching the network. The private
 * build manifests under `.astro/aeo-cache` are read when they exist; they are
 * already sanitized, and nothing here reports an absolute path or a source body.
 *
 * @param {string} distDir
 * @param {{ base?: string; projectRoot?: string; siteUrl?: string }} [options]
 * @returns {{ findings: Finding[]; pagesChecked: number; languageCount: number }}
 */
export function auditDist(distDir, options = {}) {
  const root = resolve(distDir);
  const legacy = validateDist(root, { base: options.base });
  /** @type {Finding[]} */
  const findings = [...legacy.errors, ...legacy.warnings].map(fromLegacyFinding);
  if (legacy.errors.some((finding) => finding.code === 'no-dist')) {
    return { findings, pagesChecked: 0, languageCount: 0 };
  }

  const base = normalizeBase(options.base);
  const pages = readPages(root);
  findings.push(...auditPages(pages, {
    links: createResolver(root, base, pages),
    ...(options.siteUrl ? { siteUrl: options.siteUrl } : {}),
  }));
  findings.push(...manifestFindings(options.projectRoot ?? resolve(root, '..')));

  const languages = new Set(pages.map((page) => page.language?.toLowerCase().split('-')[0]).filter(Boolean));
  return { findings: unique(findings), pagesChecked: pages.length, languageCount: languages.size };
}

/** @param {string} root @returns {PageFacts[]} */
function readPages(root) {
  /** @type {PageFacts[]} */
  const pages = [];
  for (const path of walk(root)) {
    if (!path.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    if (isRedirectStub(html)) continue;
    const file = `/${relative(root, path).split(sep).join('/')}`;
    const companion = path.replace(/\.html$/, '.md');
    pages.push(extractPageFacts(html, {
      url: pageUrl(file),
      file,
      ...(existsSync(companion) ? { markdown: readFileSync(companion, 'utf8') } : {}),
    }));
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
 * @returns {import('./site-rules.js').LinkResolver}
 */
function createResolver(root, base, pages) {
  /** @type {Map<string, PageFacts>} */
  const byPath = new Map();
  for (const page of pages) {
    const bare = page.url.length > 1 && page.url.endsWith('/') ? page.url.slice(0, -1) : page.url;
    for (const key of [page.url, bare, `${bare}/`, page.file ?? page.url]) byPath.set(key, page);
  }
  return {
    resolve(from, href) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
      let url;
      try {
        url = new URL(href, `http://audit.invalid${base}${from.url}`);
      } catch {
        return null;
      }
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

/** @param {string} projectRoot @returns {Finding[]} */
function manifestFindings(projectRoot) {
  /** @type {Finding[]} */
  const findings = [];
  try {
    const manifest = JSON.parse(readFileSync(diagnosticsManifestPath(projectRoot), 'utf8'));
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
  const ownership = readOwnershipManifest(projectRoot);
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

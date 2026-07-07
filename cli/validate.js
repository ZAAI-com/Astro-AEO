// @ts-check
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { matchMarkdownAlternateLinks } from '../src/generators/dotmd.js';

/**
 * @typedef {object} Finding
 * @property {'error'|'warn'} level
 * @property {string} code
 * @property {string} message
 * @property {string} [file]
 */

/**
 * @typedef {object} ValidateResult
 * @property {boolean} ok            No errors (warnings allowed).
 * @property {Finding[]} errors
 * @property {Finding[]} warnings
 * @property {number} pagesChecked
 */

/**
 * Validate a built dist directory for AEO output correctness.
 *
 * @param {string} distDir
 * @param {{ base?: string }} [opts]
 * @returns {ValidateResult}
 */
export function validateDist(distDir, opts = {}) {
  /** @type {Finding[]} */
  const errors = [];
  /** @type {Finding[]} */
  const warnings = [];
  const base = opts.base && opts.base !== '/' ? opts.base.replace(/\/$/, '') : '';

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    errors.push({ level: 'error', code: 'no-dist', message: `dist directory not found: ${distDir}` });
    return { ok: false, errors, warnings, pagesChecked: 0 };
  }

  const htmlFiles = walk(distDir, '.html');
  if (htmlFiles.length === 0) {
    errors.push({ level: 'error', code: 'no-html', message: 'no HTML files found in dist' });
    return { ok: false, errors, warnings, pagesChecked: 0 };
  }

  const mdFiles = new Set(walk(distDir, '.md').map((f) => toHref(distDir, f)));
  const referenced = new Set();

  // --- llms.txt ---
  const llmsPath = join(distDir, 'llms.txt');
  if (existsSync(llmsPath)) {
    const llms = readFileSync(llmsPath, 'utf8');
    validateLlmsTxt(llms, { errors, warnings });
    for (const href of extractMdLinks(llms)) {
      referenced.add(href);
      const rel = base && href.startsWith(base) ? href.slice(base.length) : href;
      if (!mdFiles.has(rel)) {
        errors.push({ level: 'error', code: 'missing-md', message: `llms.txt references a missing file: ${href}`, file: 'llms.txt' });
      }
    }
  } else {
    warnings.push({ level: 'warn', code: 'no-llms', message: 'no llms.txt found in dist' });
  }

  // --- llms-full.txt ---
  const fullPath = join(distDir, 'llms-full.txt');
  if (existsSync(llmsPath) && !existsSync(fullPath)) {
    warnings.push({ level: 'warn', code: 'no-llms-full', message: 'llms.txt exists but llms-full.txt is missing' });
  } else if (existsSync(fullPath)) {
    const full = readFileSync(fullPath, 'utf8');
    if (full.trim().length === 0) {
      warnings.push({ level: 'warn', code: 'empty-llms-full', message: 'llms-full.txt is empty' });
    } else if (!full.includes('\n---')) {
      warnings.push({ level: 'warn', code: 'llms-full-separators', message: 'llms-full.txt has no "---" page separators' });
    }
  }

  // --- per-page alternate link ---
  // Track .md companions of pages that opted out of llms.txt (no-llms): their
  // .md is intentionally unreferenced, so it must not be flagged as orphaned.
  const optedOut = new Set();
  let pagesChecked = 0;
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, 'utf8');
    if (/<meta\s+[^>]*http-equiv=(["'])refresh\1/i.test(html)) continue; // redirect stub
    // Skip pages that deliberately opt out of AEO outputs.
    const aeoMeta = html.match(/<meta\s+[^>]*name=(["'])aeo\1[^>]*content=(["'])([\s\S]*?)\2/i);
    if (aeoMeta && /\b(skip|no-dotmd)\b/i.test(aeoMeta[3])) continue;
    const robotsMeta = html.match(/<meta\s+[^>]*name=(["'])robots\1[^>]*content=(["'])([\s\S]*?)\2/i);
    if (robotsMeta && /\bnoindex\b/i.test(robotsMeta[3])) continue;
    pagesChecked++;
    // Require rel="alternate" (not just type="text/markdown") so this matches the
    // injector in src/generators/dotmd.js and a bare MIME-typed link is not
    // counted as a valid alternate.
    const links = matchMarkdownAlternateLinks(html);
    const rel = toHref(distDir, htmlFile).replace(/\.html$/, '').replace(/\/index$/, '') || '/';
    if (aeoMeta && /\bno-llms\b/i.test(aeoMeta[3])) {
      optedOut.add(rel === '/' ? '/index.md' : `${rel}.md`);
    }
    if (links.length === 0) {
      warnings.push({ level: 'warn', code: 'no-alternate-link', message: `no markdown alternate link: ${rel}`, file: rel });
    } else if (links.length > 1) {
      warnings.push({ level: 'warn', code: 'duplicate-alternate-link', message: `multiple markdown alternate links: ${rel}`, file: rel });
    }
  }

  // --- orphan .md files ---
  if (existsSync(llmsPath)) {
    for (const md of mdFiles) {
      const withBase = `${base}${md}`;
      if (!referenced.has(md) && !referenced.has(withBase) && !optedOut.has(md)) {
        warnings.push({ level: 'warn', code: 'orphan-md', message: `.md file not referenced by llms.txt: ${md}`, file: md });
      }
    }
  }

  // --- robots.txt ---
  const robotsPath = join(distDir, 'robots.txt');
  if (existsSync(robotsPath)) validateRobots(readFileSync(robotsPath, 'utf8'), { warnings });

  // --- domain-profile.json ---
  const dpPath = join(distDir, '.well-known', 'domain-profile.json');
  if (existsSync(dpPath)) validateDomainProfile(readFileSync(dpPath, 'utf8'), { errors, warnings });

  return { ok: errors.length === 0, errors, warnings, pagesChecked };
}

/**
 * @param {string} llms
 * @param {{ errors: Finding[]; warnings: Finding[] }} out
 */
function validateLlmsTxt(llms, out) {
  const lines = llms.split('\n');
  const firstContent = lines.find((l) => l.trim().length > 0) ?? '';
  if (!firstContent.startsWith('# ')) {
    out.errors.push({ level: 'error', code: 'llms-no-h1', message: 'llms.txt must start with a single "# " heading', file: 'llms.txt' });
  }
  const h1Count = lines.filter((l) => /^# /.test(l)).length;
  if (h1Count > 1) {
    out.warnings.push({ level: 'warn', code: 'llms-multiple-h1', message: `llms.txt has ${h1Count} H1 headings (expected 1)`, file: 'llms.txt' });
  }
  const hasSection = lines.some((l) => /^## /.test(l));
  const hasEntry = lines.some((l) => /^-\s+\[.+\]\(.+\)/.test(l));
  if (!hasSection && !hasEntry) {
    out.warnings.push({ level: 'warn', code: 'llms-empty', message: 'llms.txt has no sections or entries', file: 'llms.txt' });
  }
}

/**
 * @param {string} robots
 * @param {{ warnings: Finding[] }} out
 */
function validateRobots(robots, out) {
  for (const raw of robots.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^(User-agent|Allow|Disallow|Sitemap|Crawl-delay|Host)\s*:/i.test(line)) {
      out.warnings.push({ level: 'warn', code: 'robots-unknown-line', message: `unrecognized robots.txt line: ${line}`, file: 'robots.txt' });
    }
    const m = line.match(/^Sitemap\s*:\s*(.+)$/i);
    if (m && !/^https?:\/\//i.test(m[1].trim())) {
      out.warnings.push({ level: 'warn', code: 'robots-relative-sitemap', message: `Sitemap URL should be absolute: ${m[1].trim()}`, file: 'robots.txt' });
    }
  }
}

/**
 * @param {string} raw
 * @param {{ errors: Finding[]; warnings: Finding[] }} out
 */
function validateDomainProfile(raw, out) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    out.errors.push({ level: 'error', code: 'dp-invalid-json', message: 'domain-profile.json is not valid JSON', file: '.well-known/domain-profile.json' });
    return;
  }
  for (const key of ['@context', '@type', 'name']) {
    if (!json[key]) {
      out.errors.push({ level: 'error', code: 'dp-missing-field', message: `domain-profile.json is missing "${key}"`, file: '.well-known/domain-profile.json' });
    }
  }
  for (const key of ['url', 'logo']) {
    if (json[key] && !/^https?:\/\//i.test(String(json[key]))) {
      out.warnings.push({ level: 'warn', code: 'dp-relative-url', message: `domain-profile.json "${key}" should be an absolute URL`, file: '.well-known/domain-profile.json' });
    }
  }
}

/**
 * Recursively list files with a given extension.
 * @param {string} dir
 * @param {string} ext
 * @returns {string[]}
 */
function walk(dir, ext) {
  const skipDirs = new Set(['node_modules', 'pagefind', '_astro']);
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || skipDirs.has(entry.name)) continue;
      out.push(...walk(full, ext));
    } else if (entry.name.endsWith(ext) && !entry.name.startsWith('.')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Convert an absolute file path into a site-root-relative href.
 * @param {string} distDir
 * @param {string} file
 * @returns {string}
 */
function toHref(distDir, file) {
  return `/${relative(distDir, file).split('\\').join('/')}`;
}

/**
 * Extract markdown link targets from llms.txt entries.
 * @param {string} llms
 * @returns {string[]}
 */
function extractMdLinks(llms) {
  const hrefs = [];
  const re = /^-\s+\[[^\]]*\]\(([^)]+\.md)\)/gm;
  let m;
  while ((m = re.exec(llms))) hrefs.push(m[1]);
  return hrefs;
}

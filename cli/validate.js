// @ts-check
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { matchMarkdownAlternateLinks } from '../src/generators/dotmd.js';
import { extractMetaContent, extractTitle } from '../src/core/page-meta.js';
import { validateLocalSitemap } from '../src/build/sitemap-validate.js';
import { validateCorpusArtifacts } from './validate-corpus.js';

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
 * @property {number} artifactsChecked
 * @property {number} sitemapsChecked
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
  const requestedBase = opts.base && opts.base !== '/'
    ? `/${opts.base.replace(/^\/+|\/+$/g, '')}`
    : '';

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    errors.push({ level: 'error', code: 'no-dist', message: `dist directory not found: ${distDir}` });
    return { ok: false, errors, warnings, pagesChecked: 0, artifactsChecked: 0, sitemapsChecked: 0 };
  }

  const corpus = validateCorpusArtifacts(distDir, requestedBase, { errors, warnings });
  const base = corpus.base;
  const htmlFiles = walk(distDir, '.html');
  if (htmlFiles.length === 0) {
    errors.push({ level: 'error', code: 'no-html', message: 'no HTML files found in dist' });
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
  } else if (!corpus.hasCorpus) {
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
    const robotsMeta = extractMetaContent(html, { name: 'robots' });
    // "none" is equivalent to "noindex, nofollow", so treat it as opting out too.
    if (robotsMeta && /\b(?:noindex|none)\b/i.test(robotsMeta)) continue;
    pagesChecked++;
    // Require rel="alternate" (not just type="text/markdown") so this matches the
    // injector in src/generators/dotmd.js and a bare MIME-typed link is not
    // counted as a valid alternate.
    const links = matchMarkdownAlternateLinks(html);
    const rel = toHref(distDir, htmlFile).replace(/\.html$/, '').replace(/\/index$/, '') || '/';
    validateTitleLength(html, rel, { warnings });
    validateImageAlt(html, rel, { errors });
    validateSocialMeta(html, rel, { warnings });
    validateRobotsMeta(html, rel, { warnings });
    if (aeoMeta && /\bno-llms\b/i.test(aeoMeta[3])) {
      optedOut.add(rel === '/' ? '/index.md' : `${rel}.md`);
    }
    if (links.length === 0) {
      warnings.push({ level: 'warn', code: 'no-alternate-link', message: `no markdown alternate link: ${rel}`, file: rel });
    } else if (links.length > 1) {
      warnings.push({ level: 'warn', code: 'duplicate-alternate-link', message: `multiple markdown alternate links: ${rel}`, file: rel });
    }
  }

  for (const href of corpus.referencedMarkdown) referenced.add(href);

  // --- orphan .md files ---
  if (corpus.hasCorpus) {
    for (const md of mdFiles) {
      const withBase = `${base}${md}`;
      if (!referenced.has(md) && !referenced.has(withBase) && !optedOut.has(md)) {
        warnings.push({ level: 'warn', code: 'orphan-md', message: `.md file not referenced by llms.txt: ${md}`, file: md });
      }
    }
  }

  // --- robots.txt ---
  const robotsPath = join(distDir, 'robots.txt');
  let sitemapsChecked = 0;
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, 'utf8');
    validateRobots(robots, { warnings });
    const localOrigin = corpus.origin ?? validationOrigin(distDir, robots);
    sitemapsChecked = validateRobotsReferences(
      robots,
      distDir,
      base,
      corpus.corpusPaths,
      localOrigin,
      { errors, warnings },
    );
  }

  // --- domain-profile.json ---
  const dpPath = join(distDir, '.well-known', 'domain-profile.json');
  if (existsSync(dpPath)) validateDomainProfile(readFileSync(dpPath, 'utf8'), { errors, warnings });

  const uniqueErrors = uniqueFindings(errors);
  const uniqueWarnings = uniqueFindings(warnings);
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
    pagesChecked,
    artifactsChecked: corpus.artifactsChecked,
    sitemapsChecked,
  };
}

/**
 * Validate local robots sitemap and corpus references without performing any
 * network access. A different-origin reference is reported and left alone.
 * @param {string} robots
 * @param {string} distDir
 * @param {string} base
 * @param {Set<string>} corpusPaths
 * @param {string | undefined} localOrigin
 * @param {{ errors: Finding[]; warnings: Finding[] }} out
 */
function validateRobotsReferences(robots, distDir, base, corpusPaths, localOrigin, out) {
  let checked = 0;
  const seen = new Set();
  for (const raw of robots.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const sitemap = line.match(/^Sitemap\s*:\s*(.+)$/i);
    if (sitemap) {
      let url;
      try {
        url = new URL(sitemap[1].trim());
      } catch {
        out.errors.push({ level: 'error', code: 'robots-sitemap-url-invalid', message: `robots.txt has an invalid Sitemap URL: ${sitemap[1].trim()}`, file: 'robots.txt' });
        continue;
      }
      if (localOrigin && url.origin !== localOrigin) {
        out.warnings.push({
          level: 'warn',
          code: 'sitemap-external-unchecked',
          message: `external sitemap was not fetched or validated: ${url.origin}${url.pathname}`,
          file: 'robots.txt',
        });
        continue;
      }
      if (seen.has(url.href)) {
        out.warnings.push({ level: 'warn', code: 'robots-sitemap-duplicate', message: `robots.txt repeats Sitemap URL: ${url.href}`, file: 'robots.txt' });
        continue;
      }
      seen.add(url.href);
      const appPath = withoutBase(url.pathname, base);
      if (!appPath) {
        out.errors.push({ level: 'error', code: 'robots-sitemap-outside-base', message: `robots.txt Sitemap URL is outside the configured base: ${url.href}`, file: 'robots.txt' });
        continue;
      }
      const result = validateLocalSitemap({
        distDir,
        entryPath: appPath,
        siteUrl: url.origin,
        base,
      });
      checked += result.documentsChecked;
      for (const finding of result.findings) {
        const target = finding.severity === 'error' ? out.errors : out.warnings;
        target.push({
          level: finding.severity === 'error' ? 'error' : 'warn',
          code: finding.code,
          message: finding.message,
          file: finding.sourcePath ?? finding.pathname ?? appPath,
        });
      }
      continue;
    }

    const corpus = raw.match(/^\s*#\s*llms(?:\.txt)?\s*:\s*(\S+)\s*$/i);
    if (!corpus) continue;
    let corpusUrl;
    try {
      corpusUrl = new URL(corpus[1]);
    } catch {
      out.errors.push({ level: 'error', code: 'robots-corpus-url-invalid', message: `robots.txt has an invalid corpus URL: ${corpus[1]}`, file: 'robots.txt' });
      continue;
    }
    if (localOrigin && corpusUrl.origin !== localOrigin) {
      out.warnings.push({ level: 'warn', code: 'robots-corpus-external', message: `external corpus reference was not fetched: ${corpusUrl.origin}${corpusUrl.pathname}`, file: 'robots.txt' });
      continue;
    }
    const pathname = corpusUrl.pathname;
    if (!corpusPaths.has(pathname)) {
      out.errors.push({ level: 'error', code: 'robots-corpus-missing', message: `robots.txt references a missing corpus: ${pathname}`, file: 'robots.txt' });
    }
  }
  return checked;
}

/** @param {string} distDir @param {string} robots */
function validationOrigin(distDir, robots) {
  const profile = join(distDir, '.well-known', 'domain-profile.json');
  try {
    const value = JSON.parse(readFileSync(profile, 'utf8'))?.url;
    if (typeof value === 'string') return new URL(value).origin;
  } catch {
    // Fall through to the non-standard corpus hint.
  }
  for (const line of robots.split('\n')) {
    const match = line.match(/^\s*#\s*llms(?:\.txt)?\s*:\s*(\S+)\s*$/i);
    if (!match) continue;
    try {
      return new URL(match[1]).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
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
 * @param {string} html
 * @param {string} rel
 * @param {{ warnings: Finding[] }} out
 */
function validateTitleLength(html, rel, out) {
  const title = extractTitle(html);
  if (!title) {
    out.warnings.push({ level: 'warn', code: 'title-length', message: `title is missing or empty: ${rel}`, file: rel });
    return;
  }
  if (title.length < 30 || title.length > 60) {
    out.warnings.push({
      level: 'warn',
      code: 'title-length',
      message: `title length should be 30-60 characters (found ${title.length}): ${rel}`,
      file: rel,
    });
  }
}

/**
 * @param {string} html
 * @param {string} rel
 * @param {{ errors: Finding[] }} out
 */
function validateImageAlt(html, rel, out) {
  const missingAlt = findImagesMissingAlt(html);
  if (missingAlt > 0) {
    out.errors.push({
      level: 'error',
      code: 'img-missing-alt',
      message: `${missingAlt} image${missingAlt === 1 ? '' : 's'} missing alt attribute: ${rel}`,
      file: rel,
    });
  }
}

/**
 * @param {string} html
 * @param {string} rel
 * @param {{ warnings: Finding[] }} out
 */
function validateSocialMeta(html, rel, out) {
  const ogTitle = extractMetaContent(html, { property: 'og:title' });
  if (ogTitle === undefined) return;

  const title = ogTitle.trim();
  if (title.length < 10 || title.length > 70) {
    out.warnings.push({
      level: 'warn',
      code: 'og-title-length',
      message: `og:title length should be 10-70 characters (found ${title.length}): ${rel}`,
      file: rel,
    });
  }

  const ogDescription = extractMetaContent(html, { property: 'og:description' });
  if (ogDescription !== undefined) {
    const description = ogDescription.trim();
    if (description.length < 50 || description.length > 200) {
      out.warnings.push({
        level: 'warn',
        code: 'og-description-length',
        message: `og:description length should be 50-200 characters (found ${description.length}): ${rel}`,
        file: rel,
      });
    }
  }

  const twitterCard = extractMetaContent(html, { name: 'twitter:card' });
  if (twitterCard !== undefined && twitterCard.trim().toLowerCase() !== 'summary_large_image') {
    out.warnings.push({
      level: 'warn',
      code: 'twitter-card-type',
      message: `twitter:card should be summary_large_image: ${rel}`,
      file: rel,
    });
  }

  const ogImage = extractMetaContent(html, { property: 'og:image' });
  if (ogImage === undefined) {
    out.warnings.push({ level: 'warn', code: 'og-image-missing', message: `og:image is missing: ${rel}`, file: rel });
  } else if (!/^https?:\/\//i.test(ogImage.trim())) {
    out.warnings.push({ level: 'warn', code: 'og-image-relative', message: `og:image should be an absolute URL: ${rel}`, file: rel });
  }
}

/**
 * @param {string} html
 * @param {string} rel
 * @param {{ warnings: Finding[] }} out
 */
function validateRobotsMeta(html, rel, out) {
  if (extractMetaContent(html, { name: 'robots' }) === undefined) {
    out.warnings.push({ level: 'warn', code: 'robots-meta-missing', message: `robots meta tag is missing: ${rel}`, file: rel });
  }
}

/**
 * @param {string} html
 * @returns {number}
 */
function findImagesMissingAlt(html) {
  let count = 0;
  // Quote-aware so a ">" inside a quoted attribute value does not truncate the
  // tag and cause a false missing-alt error.
  const imgRe = /<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let match;
  while ((match = imgRe.exec(html))) {
    if (!/(?:^|\s)alt\s*=/i.test(match[0])) count++;
  }
  return count;
}

/**
 * @param {string} robots
 * @param {{ warnings: Finding[] }} out
 */
function validateRobots(robots, out) {
  const userAgents = [];
  for (const raw of robots.split('\n')) {
    // Strip inline comments ("#" to end of line) so directive values like
    // "User-agent: * # default" parse as "*", not "* # default".
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^(User-agent|Allow|Disallow|Sitemap|Crawl-delay|Host)\s*:/i.test(line)) {
      out.warnings.push({ level: 'warn', code: 'robots-unknown-line', message: `unrecognized robots.txt line: ${line}`, file: 'robots.txt' });
    }
    const ua = line.match(/^User-agent\s*:\s*(.+)$/i);
    if (ua) userAgents.push(ua[1].trim());
    const m = line.match(/^Sitemap\s*:\s*(.+)$/i);
    if (m && !/^https?:\/\//i.test(m[1].trim())) {
      out.warnings.push({ level: 'warn', code: 'robots-relative-sitemap', message: `Sitemap URL should be absolute: ${m[1].trim()}`, file: 'robots.txt' });
    }
  }
  if (userAgents.length > 0 && !userAgents.includes('*')) {
    out.warnings.push({
      level: 'warn',
      code: 'robots-no-wildcard',
      message: 'robots.txt names specific user-agents but has no User-agent: * group; unlisted crawlers rely on the implicit-allow default. Add a User-agent: * group to state the policy explicitly.',
      file: 'robots.txt',
    });
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

/** @param {string} pathname @param {string} base */
function withoutBase(pathname, base) {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

/** @param {Finding[]} findings */
function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.level, finding.code, finding.message, finding.file ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

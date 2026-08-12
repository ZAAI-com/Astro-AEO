// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { countApproximateTokens, normalizePublishedText } from '../src/core/corpus-tokenizer.js';
import { normalizeCorpusManifest } from '../src/core/corpus-manifest.js';

const HASH = /^sha256:[a-f\d]{64}$/;
const ARTIFACT_KINDS = new Set(['index', 'full', 'small', 'chunk', 'alias']);
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * @typedef {import('./validate.js').Finding} Finding
 * @typedef {{ errors: Finding[]; warnings: Finding[] }} FindingOutput
 */

/**
 * Validate a corpus manifest when present, otherwise discover every locale
 * family and chunk from the filesystem. The standalone validator never imports
 * a configured custom tokenizer.
 *
 * @param {string} distDir
 * @param {string} requestedBase
 * @param {FindingOutput} out
 */
export function validateCorpusArtifacts(distDir, requestedBase, out) {
  const manifestPath = join(distDir, 'llms', 'manifest.json');
  const corpusFiles = discoverCorpusFiles(distDir, requestedBase);
  /** @type {Set<string>} */
  const referencedMarkdown = new Set();
  let artifactsChecked = 0;
  let manifest = null;
  let manifestBase = requestedBase;

  if (existsSync(manifestPath)) {
    const raw = readFileSafely(manifestPath);
    if (!raw) {
      error(out, 'corpus-manifest-read', 'corpus manifest could not be read', '/llms/manifest.json');
    } else {
      try {
        manifest = JSON.parse(raw.toString('utf8'));
      } catch {
        error(out, 'corpus-manifest-json', 'corpus manifest is not valid JSON', '/llms/manifest.json');
      }
      if (manifest && !basicManifestShape(manifest)) {
        error(out, 'corpus-manifest-shape', 'corpus manifest does not match the version 1 contract', '/llms/manifest.json');
        manifest = null;
      }
    }
  }

  if (manifest) {
    manifestBase = normalizeBase(manifest.base);
    if (requestedBase && manifestBase !== requestedBase) {
      error(out, 'corpus-manifest-base', `manifest base ${manifest.base} does not match requested base ${requestedBase}`, '/llms/manifest.json');
    }
    validateManifestFormatting(manifestPath, manifest, out);
    artifactsChecked += validateManifestRecords(distDir, manifest, manifestBase, referencedMarkdown, out);
  } else {
    artifactsChecked += validateDiscoveredFiles(distDir, corpusFiles, requestedBase, referencedMarkdown, out);
  }

  return {
    artifactsChecked,
    referencedMarkdown,
    hasCorpus: Boolean(manifest || corpusFiles.some((entry) => entry.pathname.endsWith('.txt'))),
    manifest,
    origin: manifest?.origin,
    base: manifestBase,
    corpusPaths: new Set(corpusFiles.map((entry) =>
      withBase(`/${relative(distDir, entry.path).split(sep).join('/')}`, manifestBase))),
  };
}

/** @param {string} manifestPath @param {any} manifest @param {FindingOutput} out */
function validateManifestFormatting(manifestPath, manifest, out) {
  try {
    const normalized = `${JSON.stringify(normalizeCorpusManifest(manifest), null, 2)}\n`;
    const actual = readFileSync(manifestPath, 'utf8');
    if (actual !== normalized) {
      error(out, 'corpus-manifest-format', 'corpus manifest is not normalized two-space JSON with one trailing newline', '/llms/manifest.json');
    }
  } catch (cause) {
    error(out, 'corpus-manifest-shape', `corpus manifest could not be normalized: ${message(cause)}`, '/llms/manifest.json');
  }
}

/**
 * @param {string} distDir
 * @param {any} manifest
 * @param {string} base
 * @param {Set<string>} referencedMarkdown
 * @param {FindingOutput} out
 */
function validateManifestRecords(distDir, manifest, base, referencedMarkdown, out) {
  let checked = 0;
  const builtin = manifest.tokenizer.name === 'astro-aeo-approx' && manifest.tokenizer.version === '1';
  if (builtin && manifest.tokenizer.approximate !== true) {
    error(out, 'corpus-tokenizer-identity', 'astro-aeo-approx@1 must be recorded as approximate', '/llms/manifest.json');
  }
  const artifactKeys = new Set();
  /** @type {Map<string, { record: any; bytes: Buffer; text?: string }>} */
  const artifacts = new Map();

  for (const record of manifest.artifacts) {
    const key = artifactKey(record.pathname, record.encoding);
    if (artifactKeys.has(key)) {
      error(out, 'corpus-artifact-duplicate', `duplicate artifact record: ${record.pathname} (${record.encoding})`, '/llms/manifest.json');
      continue;
    }
    artifactKeys.add(key);
    if (!validArtifactRecord(record, manifest.origin)) {
      error(out, 'corpus-artifact-shape', `invalid artifact record: ${String(record?.pathname ?? '<unknown>')}`, '/llms/manifest.json');
      continue;
    }
    if (record.pathname === withBase('/llms/manifest.json', base)) {
      error(out, 'corpus-manifest-self-reference', 'corpus manifest must not list itself as an artifact', '/llms/manifest.json');
      continue;
    }
    const path = deployedPathToFile(distDir, record.pathname, base);
    if (!path || !regularNonSymlink(path)) {
      error(out, 'corpus-artifact-missing', `manifest artifact is missing or unsafe: ${record.pathname}`, record.pathname);
      continue;
    }
    const bytes = readFileSafely(path);
    if (!bytes) {
      error(out, 'corpus-artifact-read', `manifest artifact could not be read: ${record.pathname}`, record.pathname);
      continue;
    }
    checked++;
    if (digest(bytes) !== record.hash) {
      error(out, 'corpus-artifact-hash', `artifact hash mismatch: ${record.pathname}`, record.pathname);
    }
    let text;
    if (record.encoding === 'identity') {
      try {
        text = decoder.decode(bytes);
      } catch {
        error(out, 'corpus-artifact-utf8', `text artifact is not valid UTF-8: ${record.pathname}`, record.pathname);
      }
      if (text !== undefined && builtin && countApproximateTokens(text) !== record.tokenCount) {
        error(out, 'corpus-artifact-tokens', `artifact token count mismatch: ${record.pathname}`, record.pathname);
      }
    }
    artifacts.set(key, { record, bytes, ...(text === undefined ? {} : { text }) });
  }

  for (const { record, bytes } of artifacts.values()) {
    if (record.encoding === 'identity' && record.kind !== 'alias') {
      if (record.sourcePathname !== null) {
        error(out, 'corpus-artifact-source', `identity artifact must not name a source: ${record.pathname}`, record.pathname);
      }
      continue;
    }
    if (typeof record.sourcePathname !== 'string') {
      error(out, 'corpus-artifact-source', `derived artifact has no source: ${record.pathname}`, record.pathname);
      continue;
    }
    const source = artifacts.get(artifactKey(record.sourcePathname, 'identity'));
    if (!source) {
      error(out, 'corpus-artifact-source-missing', `artifact source is missing from the manifest: ${record.sourcePathname}`, record.pathname);
      continue;
    }
    if (record.tokenCount !== source.record.tokenCount) {
      error(out, 'corpus-artifact-source-tokens', `derived artifact token count differs from its source: ${record.pathname}`, record.pathname);
    }
    if (record.encoding === 'gzip') {
      if (!normalizedGzipHeader(bytes)) {
        error(out, 'corpus-gzip-metadata', `gzip artifact has non-deterministic header metadata: ${record.pathname}`, record.pathname);
      }
      let inflated;
      try {
        inflated = gunzipSync(bytes);
      } catch {
        error(out, 'corpus-gzip-invalid', `gzip artifact cannot be decompressed: ${record.pathname}`, record.pathname);
        continue;
      }
      if (!inflated.equals(source.bytes)) {
        error(out, 'corpus-gzip-content', `gzip artifact does not expand to its source bytes: ${record.pathname}`, record.pathname);
      }
    } else if (!bytes.equals(source.bytes)) {
      error(out, 'corpus-alias-content', `alias is not a byte copy of its source: ${record.pathname}`, record.pathname);
    }
  }

  const pageKeys = new Set();
  const chunkReferences = new Set();
  /** @type {{ origin: string; locale: string | null; id: string }[]} */
  const pageLocales = [];
  for (const page of manifest.pages) {
    const key = `${page.origin}\0${page.id}`;
    if (pageKeys.has(key)) error(out, 'corpus-page-duplicate', `duplicate page record: ${page.origin}${page.id}`, '/llms/manifest.json');
    pageKeys.add(key);
    if (!validPageRecord(page, manifest.origin)) {
      error(out, 'corpus-page-shape', `invalid page record: ${String(page?.id ?? '<unknown>')}`, '/llms/manifest.json');
      continue;
    }
    pageLocales.push({ origin: page.origin, locale: page.locale, id: page.id });
    const markdownPathname = sameOriginPath(page.markdownUrl, page.origin);
    if (!markdownPathname) {
      error(out, 'corpus-page-markdown-url', `page Markdown URL is invalid or cross-origin: ${page.markdownUrl}`, '/llms/manifest.json');
      continue;
    }
    referencedMarkdown.add(markdownPathname);
    const path = deployedPathToFile(distDir, markdownPathname, base);
    if (!path || !regularNonSymlink(path)) {
      error(out, 'corpus-page-markdown-missing', `page Markdown is missing: ${page.markdownUrl}`, markdownPathname);
    } else {
      const bytes = readFileSafely(path);
      if (bytes) {
        checked++;
        let markdown;
        try {
          markdown = decoder.decode(bytes);
        } catch {
          error(out, 'corpus-page-markdown-utf8', `page Markdown is not valid UTF-8: ${page.markdownUrl}`, markdownPathname);
        }
        if (markdown !== undefined) {
          if (digest(Buffer.from(normalizePublishedText(markdown), 'utf8')) !== page.hash) {
            error(out, 'corpus-page-hash', `page Markdown hash mismatch: ${page.markdownUrl}`, markdownPathname);
          }
          if (builtin && countApproximateTokens(markdown) !== page.tokenCount) {
            error(out, 'corpus-page-tokens', `page token count mismatch: ${page.markdownUrl}`, markdownPathname);
          }
        }
      }
    }
    for (const chunkPath of page.chunks) {
      chunkReferences.add(chunkPath);
      const chunk = artifacts.get(artifactKey(chunkPath, 'identity'))?.record;
      if (!chunk || chunk.kind !== 'chunk') {
        error(out, 'corpus-page-chunk-missing', `page references an unknown chunk: ${chunkPath}`, '/llms/manifest.json');
      } else if (chunk.locale !== page.locale || chunk.section !== page.section) {
        error(out, 'corpus-page-chunk-metadata', `page and chunk locale/section differ: ${chunkPath}`, '/llms/manifest.json');
      }
    }
  }

  for (const { record } of artifacts.values()) {
    if (record.kind === 'chunk' && record.encoding === 'identity' && !chunkReferences.has(record.pathname)) {
      warn(out, 'corpus-chunk-unreferenced', `chunk is not referenced by any page: ${record.pathname}`, record.pathname);
    }
  }

  const seenLocaleKeys = new Set();
  const localeKeys = new Set();
  for (const locale of manifest.locales) {
    const key = `${locale.origin}\0${locale.locale ?? ''}`;
    if (seenLocaleKeys.has(key)) error(out, 'corpus-locale-duplicate', `duplicate locale record: ${key}`, '/llms/manifest.json');
    seenLocaleKeys.add(key);
    if (!validLocaleRecord(locale, manifest.origin)) {
      error(out, 'corpus-locale-shape', `invalid locale record: ${String(locale?.locale ?? '<implicit>')}`, '/llms/manifest.json');
      continue;
    }
    localeKeys.add(key);
    const canonical = artifacts.get(artifactKey(locale.canonicalArtifact, 'identity'))?.record;
    if (!canonical || canonical.kind === 'alias') {
      error(out, 'corpus-locale-canonical-missing', `locale canonical artifact is missing or is an alias: ${locale.canonicalArtifact}`, '/llms/manifest.json');
      continue;
    }
    const candidates = [...artifacts.values()]
      .map((entry) => entry.record)
      .filter((entry) => entry.encoding === 'identity' && entry.kind !== 'alias' && (
        entry.locale === locale.locale || entry.pathname === locale.canonicalArtifact
      ))
      .sort(compareCandidateArtifacts);
    if (candidates.length > 0 && candidates[0].pathname !== locale.canonicalArtifact) {
      error(out, 'corpus-locale-canonical-order', `locale canonical artifact does not follow index/full/small/chunk precedence: ${locale.canonicalArtifact}`, '/llms/manifest.json');
    }
  }
  for (const page of pageLocales) {
    if (!localeKeys.has(`${page.origin}\0${page.locale ?? ''}`)) {
      error(out, 'corpus-page-locale-missing', `page ${page.id} references a locale absent from the manifest`, '/llms/manifest.json');
    }
  }

  return checked;
}

/**
 * @param {string} distDir
 * @param {{ path: string; pathname: string }[]} files
 * @param {string} base
 * @param {Set<string>} referencedMarkdown
 * @param {FindingOutput} out
 */
function validateDiscoveredFiles(distDir, files, base, referencedMarkdown, out) {
  let checked = 0;
  const byPathname = new Map(files.map((entry) => [entry.pathname, entry]));
  for (const file of files) {
    if (file.pathname.endsWith('.gz')) {
      const source = byPathname.get(file.pathname.slice(0, -3));
      if (!source) {
        error(out, 'corpus-gzip-source-missing', `gzip corpus has no source sibling: ${file.pathname}`, file.pathname);
        continue;
      }
      try {
        const bytes = readFileSync(file.path);
        if (!normalizedGzipHeader(bytes)) {
          error(out, 'corpus-gzip-metadata', `gzip corpus has non-deterministic header metadata: ${file.pathname}`, file.pathname);
        }
        if (!gunzipSync(bytes).equals(readFileSync(source.path))) {
          error(out, 'corpus-gzip-content', `gzip corpus does not expand to its source bytes: ${file.pathname}`, file.pathname);
        }
      } catch {
        error(out, 'corpus-gzip-invalid', `gzip corpus cannot be decompressed: ${file.pathname}`, file.pathname);
      }
      checked++;
      continue;
    }

    let text;
    try {
      text = readFileSync(file.path, 'utf8');
    } catch {
      error(out, 'corpus-artifact-read', `corpus file could not be read: ${file.pathname}`, file.pathname);
      continue;
    }
    checked++;
    if (!text.trim()) warn(out, 'corpus-artifact-empty', `corpus file is empty: ${file.pathname}`, file.pathname);
    if (!firstContentLine(text).startsWith('# ')) {
      error(out, 'corpus-artifact-no-h1', `corpus file must start with a single "# " heading: ${file.pathname}`, file.pathname);
    }
    if (unclosedFence(text)) {
      error(out, 'corpus-chunk-fence', `corpus file contains an unclosed fenced code block: ${file.pathname}`, file.pathname);
    }
    for (const href of extractLinks(text)) {
      const pathname = localLinkPath(href);
      if (!pathname) continue;
      if (pathname.endsWith('.md')) referencedMarkdown.add(pathname);
      if ((pathname.endsWith('.md') || pathname.endsWith('.txt')) && !regularNonSymlink(deployedPathToFile(distDir, pathname, base))) {
        error(out, pathname.endsWith('.md') ? 'missing-md' : 'corpus-link-missing', `${file.pathname} references a missing file: ${href}`, file.pathname);
      }
    }

    const alias = aliasSourcePath(file.pathname, base);
    if (alias) {
      const source = byPathname.get(alias);
      if (!source) {
        error(out, 'corpus-alias-source-missing', `locale alias has no canonical family: ${file.pathname}`, file.pathname);
      } else if (!readFileSync(file.path).equals(readFileSync(source.path))) {
        error(out, 'corpus-alias-content', `locale alias is not a byte copy: ${file.pathname}`, file.pathname);
      }
    }
  }
  return checked;
}

/** @param {unknown} value */
function basicManifestShape(value) {
  if (!record(value) || value.version !== 1 || !isOrigin(value.origin) || !validBase(value.base)) return false;
  if (!record(value.tokenizer) || typeof value.tokenizer.name !== 'string' || !value.tokenizer.name || typeof value.tokenizer.version !== 'string' || !value.tokenizer.version || typeof value.tokenizer.approximate !== 'boolean') return false;
  return Array.isArray(value.locales) && value.locales.length > 0 && Array.isArray(value.pages) &&
    Array.isArray(value.artifacts) && value.artifacts.length > 0;
}

/** @param {any} value @param {string} manifestOrigin */
function validArtifactRecord(value, manifestOrigin) {
  if (!(record(value) && value.origin === manifestOrigin && safePathname(value.pathname) && ARTIFACT_KINDS.has(value.kind) &&
    (typeof value.locale === 'string' || value.locale === null) && (typeof value.section === 'string' || value.section === null) &&
    (Number.isSafeInteger(value.part) && value.part > 0 || value.part === null) && nonnegativeInteger(value.tokenCount) && HASH.test(value.hash) &&
    (value.encoding === 'identity' || value.encoding === 'gzip') && (typeof value.sourcePathname === 'string' || value.sourcePathname === null))) return false;
  if (value.encoding === 'gzip' ? !value.pathname.endsWith('.gz') : value.pathname.endsWith('.gz')) return false;
  if (value.kind === 'chunk') {
    if (!Number.isSafeInteger(value.part) || value.part < 1 || typeof value.section !== 'string' || !value.section) return false;
  } else if (value.part !== null) return false;
  return value.sourcePathname === null || safePathname(value.sourcePathname);
}

/** @param {any} value @param {string} manifestOrigin */
function validPageRecord(value, manifestOrigin) {
  return record(value) && value.origin === manifestOrigin && safeAppId(value.id) && sameOriginPath(value.canonicalUrl, value.origin) !== null &&
    typeof value.markdownUrl === 'string' && value.markdownUrl.endsWith('.md') && (typeof value.locale === 'string' && value.locale.length > 0 || value.locale === null) &&
    (typeof value.language === 'string' && canonicalLanguage(value.language) === value.language || value.language === null) && typeof value.section === 'string' && value.section.length > 0 && nonnegativeInteger(value.tokenCount) &&
    HASH.test(value.hash) && typeof value.sourceStrategy === 'string' && value.sourceStrategy.length > 0 &&
    (value.modified === undefined || typeof value.modified === 'string' && !Number.isNaN(Date.parse(value.modified))) && Array.isArray(value.chunks) && value.chunks.every(safePathname);
}

/** @param {any} value @param {string} manifestOrigin */
function validLocaleRecord(value, manifestOrigin) {
  return record(value) && value.origin === manifestOrigin &&
    (value.locale === null && value.language === null ||
      typeof value.locale === 'string' && value.locale.length > 0 && typeof value.language === 'string' && canonicalLanguage(value.language) === value.language) &&
    safePathname(value.canonicalArtifact);
}

/** @param {string} value @param {string} origin */
function sameOriginPath(value, origin) {
  if (safePathname(value)) return value;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

/** @param {string} distDir @param {string} pathname @param {string} base */
function deployedPathToFile(distDir, pathname, base) {
  if (!safePathname(pathname)) return null;
  const appPath = stripBase(pathname, base);
  if (appPath === null || !appPath) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(appPath);
  } catch {
    return null;
  }
  const candidate = resolve(distDir, decoded.replace(/^\/+/, ''));
  const fromRoot = relative(distDir, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  let current = distDir;
  for (const part of fromRoot.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return null;
    } catch {
      break;
    }
  }
  return candidate;
}

/** @param {string} distDir @param {string} base */
function discoverCorpusFiles(distDir, base) {
  /** @type {{ path: string; pathname: string }[]} */
  const files = [];
  /** @param {string} directory @param {string[]} parts */
  const visit = (directory, parts) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== '_astro' && entry.name !== 'node_modules') visit(path, [...parts, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = [...parts, entry.name].join('/');
      if (isCorpusFilename(relativePath)) files.push({ path, pathname: withBase(`/${relativePath}`, base) });
    }
  };
  visit(distDir, []);
  return files.sort((left, right) => compare(left.pathname, right.pathname));
}

/** @param {string} pathname */
function isCorpusFilename(pathname) {
  return /(?:^|\/)llms(?:-full|-small|-[^/]+)?\.txt(?:\.gz)?$/.test(pathname) ||
    /(?:^|\/)llms\/[^/]+-\d{4,}\.txt(?:\.gz)?$/.test(pathname);
}

/** @param {string} pathname @param {string} base */
function aliasSourcePath(pathname, base) {
  const app = stripBase(pathname, base) ?? pathname;
  const name = app.replace(/^\/+/, '');
  if (name === 'llms.txt' || name === 'llms-full.txt' || name === 'llms-small.txt') return null;
  const match = name.match(/^llms(?:-(full|small))?-(.+)\.txt$/);
  if (!match) return null;
  const family = match[1] ? `llms-${match[1]}.txt` : 'llms.txt';
  return withBase(`/${match[2]}/${family}`, base);
}

/** @param {string} text */
function extractLinks(text) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text))) links.push(match[1]);
  return links;
}

/** @param {string} href */
function localLinkPath(href) {
  if (safePathname(href)) return href;
  // Filesystem fallback has no trustworthy origin contract. Generated
  // same-host links are root-relative; absolute links may intentionally point
  // at another configured locale domain and must not be treated as local.
  return null;
}

/** @param {string} text */
function unclosedFence(text) {
  let marker = null;
  for (const line of normalizePublishedText(text).split('\n')) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (!match) continue;
    const kind = match[1][0];
    const length = match[1].length;
    if (!marker) marker = { kind, length };
    else if (marker.kind === kind && length >= marker.length) marker = null;
  }
  return marker !== null;
}

/** @param {Buffer} bytes */
function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** @param {Buffer} bytes */
function normalizedGzipHeader(bytes) {
  return bytes.length >= 10 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8 &&
    (bytes[3] & 0x1c) === 0 && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0;
}

/** @param {string} path */
function readFileSafely(path) {
  try {
    return regularNonSymlink(path) ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

/** @param {string | null} path */
function regularNonSymlink(path) {
  if (!path) return false;
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function isOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.origin === value;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function validBase(value) {
  if (value === '/') return true;
  return typeof value === 'string' && safePathname(value) && value.length > 1 && !value.endsWith('/') && !value.includes('//');
}

/** @param {unknown} value */
function canonicalLanguage(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    return Intl.getCanonicalLocales(value.replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function safePathname(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[?#]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !decoded.split('/').some((part) => part === '.' || part === '..' || part.includes('\\'));
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function safeAppId(value) {
  return safePathname(value);
}

/** @param {unknown} value */
function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} pathname @param {string} encoding */
function artifactKey(pathname, encoding) {
  return `${pathname}\0${encoding}`;
}

/** @param {any} left @param {any} right */
function compareCandidateArtifacts(left, right) {
  /** @type {Record<string, number>} */
  const rank = { index: 0, full: 1, small: 2, chunk: 3, alias: 4 };
  return rank[left.kind] - rank[right.kind] || compare(left.pathname, right.pathname);
}

/** @param {string} value */
function firstContentLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim()) ?? '';
}

/** @param {string} base */
function normalizeBase(base) {
  if (!base || base === '/') return '';
  return `/${base.replace(/^\/+|\/+$/g, '')}`;
}

/** @param {string} pathname @param {string} base */
function stripBase(pathname, base) {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

/** @param {string} pathname @param {string} base */
function withBase(pathname, base) {
  if (!base) return pathname;
  return pathname === '/' ? `${base}/` : `${base}${pathname}`;
}

/** @param {FindingOutput} out @param {string} code @param {string} messageText @param {string} [file] */
function error(out, code, messageText, file) {
  out.errors.push({ level: 'error', code, message: messageText, ...(file ? { file } : {}) });
}

/** @param {FindingOutput} out @param {string} code @param {string} messageText @param {string} [file] */
function warn(out, code, messageText, file) {
  out.warnings.push({ level: 'warn', code, message: messageText, ...(file ? { file } : {}) });
}

/** @param {unknown} value */
function message(value) {
  return value instanceof Error ? value.message : String(value);
}

/** @param {string} left @param {string} right */
function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

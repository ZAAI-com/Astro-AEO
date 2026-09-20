import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter } from '../build/artifacts.js';
import { resolveConfig } from '../config.js';
import { emitDotMd, hasMarkdownAlternateLink, matchMarkdownAlternateLinks } from './dotmd.js';

describe('hasMarkdownAlternateLink', () => {
  test('detects rel-before-type ordering', () => {
    expect(hasMarkdownAlternateLink('<link rel="alternate" type="text/markdown" href="/x.md">')).toBe(true);
  });

  test('detects type-before-rel ordering', () => {
    expect(hasMarkdownAlternateLink('<link type="text/markdown" rel="alternate" href="/x.md">')).toBe(true);
  });

  test('false when there is no markdown alternate link', () => {
    expect(hasMarkdownAlternateLink('<link rel="stylesheet" href="/x.css">')).toBe(false);
    expect(hasMarkdownAlternateLink('<link rel="alternate" type="application/rss+xml" href="/feed.xml">')).toBe(false);
  });
});

describe('matchMarkdownAlternateLinks', () => {
  test('counts each markdown alternate link, either attribute order', () => {
    const html =
      '<link rel="alternate" type="text/markdown" href="/a.md">' +
      '<link type="text/markdown" rel="alternate" href="/b.md">';
    expect(matchMarkdownAlternateLinks(html)).toHaveLength(2);
  });

  test('ignores a type="text/markdown" link without rel="alternate"', () => {
    // Bare MIME-typed link must not count as an alternate (matches the injector).
    expect(matchMarkdownAlternateLinks('<link type="text/markdown" href="/x.md">')).toHaveLength(0);
  });

  test('returns an empty array when no links are present', () => {
    expect(matchMarkdownAlternateLinks('<p>no links here</p>')).toEqual([]);
  });
});

describe('emitDotMd', () => {
  /** @type {string} */
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aeo-dotmd-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('checks route and public collisions without the Astro base prefix', () => {
    const distDir = pathToFileURL(`${join(root, 'dist')}/`);
    const publicRoot = join(root, 'public');
    mkdirSync(publicRoot, { recursive: true });
    writeFileSync(join(publicRoot, 'about.md'), 'public source');
    const warnings = [];
    const writer = createArtifactWriter({
      distDir,
      logger: { info() {}, warn: (message) => warnings.push(message) },
      routePaths: new Set(['/about.md']),
      publicDir: pathToFileURL(`${publicRoot}/`),
    });
    const page = {
      pathname: '/about',
      url: 'https://example.test/docs/about',
      mdHref: '/docs/about.md',
      title: 'About',
      description: '',
      markdown: '# About\n',
      rendering: 'prerendered',
      lastModified: undefined,
      aeoTokens: [],
      source: { strategy: 'rendered' },
      diagnostics: [],
      htmlPath: '',
      mdPath: join(root, 'dist', 'about.md'),
    };

    expect(
      emitDotMd([page], resolveConfig({ markdown: { alternateLink: 'never' } }), writer),
    ).toBe(1);
    expect(warnings.some((message) => message.includes('produced by a route'))).toBe(true);
    expect(warnings.some((message) => message.includes('also exists in public/'))).toBe(true);
  });

  test('does not claim Markdown when the normalized page directive disables it', () => {
    const distDir = pathToFileURL(`${join(root, 'dist')}/`);
    const writer = createArtifactWriter({
      distDir,
      logger: { info() {}, warn() {} },
    });
    const page = {
      pathname: '/private-source',
      url: 'https://example.test/private-source/',
      mdHref: '/private-source.md',
      title: 'Private source',
      description: '',
      markdown: '# Private source',
      rendering: 'prerendered',
      aeoTokens: [],
      directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: false },
      htmlPath: '',
      mdPath: join(root, 'dist', 'private-source.md'),
    };

    expect(emitDotMd([page], resolveConfig({ markdown: { alternateLink: 'never' } }), writer)).toBe(0);
  });

  test('does not stage an HTML transform for a catalog-only page', () => {
    let transforms = 0;
    const writer = /** @type {any} */ ({
      isDeferred: true,
      write() { return true; },
      stageTransform() { transforms++; },
    });
    const page = {
      pathname: '/catalog-only',
      url: 'https://example.test/catalog-only/',
      mdHref: '/catalog-only.md',
      title: 'Catalog only',
      description: '',
      markdown: '# Catalog only',
      rendering: 'prerendered',
      aeoTokens: [],
      directives: { generateMarkdown: true },
      htmlPath: '',
      mdPath: join(root, 'dist', 'catalog-only.md'),
    };

    expect(emitDotMd([page], resolveConfig(), writer)).toBe(1);
    expect(transforms).toBe(0);
  });

  // Only catalog descriptors carry an explicit origin. Two naming different origins
  // can share a pathname, and both resolve to the same mdPath under the same owner,
  // so the duplicate-writer warning never fired and the later write won silently.
  test('skips companions for catalog pages published on another origin', () => {
    /** @type {string[]} */
    const paths = [];
    const writer = /** @type {any} */ ({
      isDeferred: true,
      write(claim) { paths.push(claim.path); return true; },
      stageTransform() {},
    });
    const base = {
      mdHref: '/shared.md',
      title: 'Shared',
      description: '',
      markdown: '# Shared',
      rendering: 'prerendered',
      aeoTokens: [],
      directives: { generateMarkdown: true },
      htmlPath: '',
      mdPath: join(root, 'dist', 'shared.md'),
    };
    const own = { ...base, pathname: '/shared', url: 'https://example.test/shared/' };
    const foreign = {
      ...base,
      pathname: '/shared',
      origin: 'https://other.example.test',
      url: 'https://other.example.test/shared/',
    };
    /** @type {any[]} */
    const diagnostics = [];

    const written = emitDotMd([own, foreign], resolveConfig(), writer, {
      siteUrl: 'https://example.test',
      diagnostics,
    });

    expect(written).toBe(1);
    expect(paths).toEqual([join(root, 'dist', 'shared.md')]);
    expect(diagnostics).toEqual([{
      version: 1,
      code: 'catalog-foreign-origin-companion',
      severity: 'warning',
      message:
        "Catalog page /shared is published on https://other.example.test, so no .md companion "
        + "was written into this origin's output.",
      pathname: '/shared',
    }]);
  });

  test('still writes companions for pages that carry no origin of their own', () => {
    const writer = /** @type {any} */ ({ isDeferred: true, write() { return true; }, stageTransform() {} });
    const page = {
      pathname: '/plain',
      url: 'https://example.test/plain/',
      mdHref: '/plain.md',
      title: 'Plain',
      description: '',
      markdown: '# Plain',
      rendering: 'prerendered',
      aeoTokens: [],
      directives: { generateMarkdown: true },
      htmlPath: '',
      mdPath: join(root, 'dist', 'plain.md'),
    };
    /** @type {any[]} */
    const diagnostics = [];

    expect(emitDotMd([page], resolveConfig(), writer, {
      siteUrl: 'https://example.test',
      diagnostics,
    })).toBe(1);
    expect(diagnostics).toEqual([]);
  });
});

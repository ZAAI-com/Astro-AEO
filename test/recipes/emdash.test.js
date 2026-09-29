import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditDist } from '../../src/audit/local.js';
import { spawnProcessTree } from '../../scripts/process-tree.mjs';
import { ASTRO_BIN, REPO, fetchWithHost, stopProcess, waitForReady } from '../adapters/helpers.js';

// Every EmDash site renders on demand, so a build emits no page HTML. Each recipe
// is built once here, audited, then served from its standalone Node entry so the
// request-time contract can be asserted against its seeded database. The four
// emdash-<template> recipes mirror EmDash's own templates; `emdash` mixes them, and
// `emdash-cloudflare` runs the same site in workerd on a local D1 database.

const EMDASH_BIN = join(REPO, 'node_modules/emdash/dist/cli/index.mjs');
const HOST = 'recipe.example.com';
const MARKDOWN_ACCEPT = 'text/markdown;q=0.9,text/html;q=0.8';
// EmDash requires Node 22.16 or newer.
const [major, minor] = process.versions.node.split('.').map(Number);
const SUPPORTED = major > 22 || (major === 22 && minor >= 16);

/**
 * @typedef {{
 *   name: string;
 *   platform?: 'node' | 'cloudflare';
 *   listed: string[];
 *   absent: string[];
 *   sections?: string[];
 *   companion: { path: string; heading: string };
 *   negotiate: string;
 *   listing?: { path: string; texts: string[] };
 *   unpublished?: string;
 *   late?: { collection: string; match: RegExp };
 * }} RecipeCase
 */

/** @type {RecipeCase[]} */
const CASES = [
  {
    name: 'emdash-blog',
    listed: [
      '(/index.md)',
      '(/posts.md)',
      '(/posts/the-case-for-static.md)',
      '(/posts/notes-on-simplicity.md)',
      '(/pages/about.md)',
      '(/category/development.md)',
      '(/tag/webdev.md)',
    ],
    absent: ['/search', 'work-in-progress', '_emdash', '/404', 'rss.xml'],
    companion: { path: '/posts/the-case-for-static.md', heading: '# The Case for Static' },
    negotiate: '/posts/learning-in-public',
    // A listing of <article> cards keeps its heading, not just the cards.
    listing: { path: '/posts.md', texts: ['# Posts', 'The Case for Static'] },
    unpublished: '/posts/work-in-progress',
    late: { collection: 'posts', match: /\(\/posts\/late-breaking-note\.md\)/ },
  },
  {
    name: 'emdash-marketing',
    listed: ['(/index.md)', '(/pricing.md)', '(/contact.md)'],
    // The pages collection has no URL pattern, so nothing is guessed from it.
    absent: ['/pages/', '/home', '_emdash', '/404'],
    companion: { path: '/pricing.md', heading: '# Simple, transparent pricing' },
    negotiate: '/',
  },
  {
    name: 'emdash-portfolio',
    listed: [
      '(/index.md)',
      '(/work.md)',
      '(/work/meridian-brand.md)',
      '(/work/coastal-photo.md)',
      '(/about.md)',
      '(/contact.md)',
    ],
    absent: ['_emdash', '/404', 'rss.xml'],
    companion: { path: '/work/volta-web.md', heading: '# Volta' },
    negotiate: '/about',
    listing: { path: '/index.md', texts: ['# Selected work', 'Meridian'] },
  },
  {
    name: 'emdash-starter',
    listed: ['(/index.md)', '(/posts.md)', '(/posts/welcome.md)', '(/about.md)', '(/category/general.md)', '(/tag/starter.md)'],
    absent: ['_emdash', '/404'],
    companion: { path: '/about.md', heading: '# About' },
    negotiate: '/posts/welcome',
  },
  {
    name: 'emdash',
    listed: ['(/index.md)', '(/blog.md)', '(/customers.md)', '(/customers/aeo-field-guide.md)'],
    absent: ['/legal/', 'unpublished-sketch', '_emdash', '/404'],
    sections: ['## Blog', '## Customers'],
    companion: { path: '/customers/llms-corpus-explorer.md', heading: '# LLMS Corpus Explorer' },
    negotiate: '/customers/markdown-negotiation-lab',
    unpublished: '/blog/2020/01/unpublished-sketch',
    late: { collection: 'posts', match: /\(\/blog\/\d{4}\/\d{2}\/late-breaking-note\.md\)/ },
  },
  {
    name: 'emdash-cloudflare',
    platform: 'cloudflare',
    listed: ['(/index.md)', '(/blog.md)', '(/customers.md)', '(/customers/aeo-field-guide.md)'],
    absent: ['/legal/', 'unpublished-sketch', '_emdash', '/404'],
    sections: ['## Blog', '## Customers'],
    companion: { path: '/customers/llms-corpus-explorer.md', heading: '# LLMS Corpus Explorer' },
    negotiate: '/customers/markdown-negotiation-lab',
    unpublished: '/blog/2020/01/unpublished-sketch',
    late: { collection: 'posts', match: /\(\/blog\/\d{4}\/\d{2}\/late-breaking-note\.md\)/ },
  },
];

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  return env;
}

/** @param {string} cwd @param {string[]} args */
function run(cwd, args) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return result;
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** @param {string} root */
function resetDatabase(root) {
  // Stale WAL sidecar files from an earlier server corrupt a fresh database.
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(join(root, `data.db${suffix}`), { force: true });
  }
  // Miniflare keeps the local D1 database, R2 bucket and KV state here.
  rmSync(join(root, '.wrangler'), { recursive: true, force: true });
}

/**
 * The SQLite file behind the local D1 binding. Miniflare names it by a hash of
 * the binding, and creates it when the Worker first touches the database.
 * @param {string} root
 */
function localD1File(root) {
  const directory = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const [file] = readdirSync(directory).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  expect(file, 'local D1 database').toBeTruthy();
  return join(directory, file);
}

/**
 * A seed that adds one published entry to an existing collection, so a running
 * server can be shown picking it up.
 * @param {string} root
 * @param {string} collection
 */
function lateSeed(root, collection) {
  const seed = JSON.parse(readFileSync(join(root, 'seed/seed.json'), 'utf8'));
  const [template] = seed.content[collection];
  const entry = {
    ...template,
    id: 'late-breaking-note',
    slug: 'late-breaking-note',
    status: 'published',
    data: { ...template.data, title: 'A late-breaking note' },
  };
  delete entry.taxonomies;
  delete entry.bylines;
  const directory = mkdtempSync(join(tmpdir(), 'astro-aeo-emdash-late-'));
  const file = join(directory, 'late.json');
  writeFileSync(file, JSON.stringify({ version: seed.version, collections: seed.collections, content: { [collection]: [entry] } }));
  return { file, directory };
}

/**
 * Poll llms.txt until it lists every expected link.
 * @param {string} base
 * @param {string[]} links
 */
async function waitForListing(base, links) {
  let body = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    body = await (await fetchWithHost(`${base}/llms.txt`, HOST)).text();
    if (links.every((link) => body.includes(link))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`llms.txt never listed the seeded pages:\n${body}`);
}

describe.skipIf(!SUPPORTED).each(CASES)('$name recipe', (recipe) => {
  const root = join(REPO, 'recipes', recipe.name);
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let server;
  const cloudflare = recipe.platform === 'cloudflare';
  let base = '';
  let output = '';
  /** @type {string[]} */
  let databaseArgs = [];

  beforeAll(async () => {
    resetDatabase(root);
    if (!cloudflare) run(root, [EMDASH_BIN, 'seed', 'seed/seed.json']);
    // Built from the recipe root: EmDash resolves `file:./data.db` against cwd.
    run(root, [ASTRO_BIN, 'build']);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    // A Cloudflare build runs in real workerd through `astro preview`, with the
    // D1 and R2 bindings simulated locally by Miniflare.
    const [args, env] = cloudflare
      ? [[ASTRO_BIN, 'preview', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], { ASTRO_PREVIEW_BACKGROUND: '1' }]
      : [['dist/server/entry.mjs'], { HOST: '127.0.0.1', PORT: String(port) }];
    server = spawnProcessTree(process.execPath, args, {
      cwd: root,
      env: { ...cleanEnvironment(), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => (output += chunk));
    server.stderr?.on('data', (chunk) => (output += chunk));
    await waitForReady(base, { child: server, output: () => output });
    if (cloudflare) {
      // The first request created and migrated the local D1 database. EmDash's
      // setup wizard would add the sample content; the CLI seeds the same file.
      databaseArgs = ['--database', localD1File(root)];
      run(root, [EMDASH_BIN, 'seed', 'seed/seed.json', ...databaseArgs]);
      // The readiness probe already listed the empty database, so the content
      // appears once the catalog's 10 second revalidate window has passed.
      await waitForListing(base, recipe.listed);
    }
  }, 300_000);

  afterAll(async () => {
    await stopProcess(server);
  });

  test('audits with no errors beyond the absent build HTML', () => {
    const { findings } = auditDist(join(root, 'dist/client'), { projectRoot: root });
    const errors = findings.filter((finding) => finding.severity === 'error' && finding.ruleId !== 'no-html');
    expect(errors.map((finding) => `${finding.ruleId} ${finding.url ?? finding.file ?? ''}: ${finding.message}`)).toEqual([]);
  });

  test('llms.txt lists every published page with a public URL and nothing else', async () => {
    const response = await fetchWithHost(`${base}/llms.txt`, HOST);
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const link of recipe.listed) expect(body, link).toContain(link);
    for (const fragment of recipe.absent) expect(body, fragment).not.toContain(fragment);
    for (const heading of recipe.sections ?? []) expect(body).toContain(`\n${heading}\n`);
  });

  test('llms-full.txt carries the rendered pages', async () => {
    const response = await fetchWithHost(`${base}/llms-full.txt`, HOST);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(recipe.companion.heading);
  });

  test('a CMS page serves a Markdown companion and negotiates Markdown', async () => {
    const companion = await fetch(`${base}${recipe.companion.path}`);
    expect(companion.status).toBe(200);
    expect(companion.headers.get('content-type')).toContain('text/markdown');
    expect(await companion.text()).toContain(recipe.companion.heading);

    const negotiated = await fetch(`${base}${recipe.negotiate}`, { headers: { accept: MARKDOWN_ACCEPT } });
    expect(negotiated.status).toBe(200);
    expect(negotiated.headers.get('content-type')).toContain('text/markdown');
  });

  test.skipIf(!recipe.listing)('a listing page keeps its heading around the cards', async () => {
    const listing = /** @type {NonNullable<RecipeCase['listing']>} */ (recipe.listing);
    const body = await (await fetch(`${base}${listing.path}`)).text();
    for (const text of listing.texts) expect(body).toContain(text);
  });

  test('the EmDash admin is never negotiated as Markdown', async () => {
    const html = await fetch(`${base}/_emdash/admin/`, { redirect: 'manual' });
    const negotiated = await fetch(`${base}/_emdash/admin/`, {
      redirect: 'manual',
      headers: { accept: MARKDOWN_ACCEPT },
    });
    expect(negotiated.status).toBe(html.status);
    expect(negotiated.headers.get('content-type') ?? '').not.toContain('text/markdown');
  });

  test.skipIf(!recipe.unpublished)('an unpublished entry has no page or companion', async () => {
    for (const path of [recipe.unpublished, `${recipe.unpublished}.md`]) {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(response.status, path).not.toBe(200);
    }
  });

  test('EmDash keeps serving its own robots.txt and sitemap', async () => {
    const robots = await fetch(`${base}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('Disallow: /_emdash/');
    expect((await fetch(`${base}/sitemap.xml`)).status).toBe(200);
  });

  test('the build emitted no corpus files and no database outside the recipe', () => {
    expect(existsSync(join(root, 'dist/client/llms.txt'))).toBe(false);
    expect(existsSync(join(REPO, 'data.db'))).toBe(false);
  });

  test.skipIf(!recipe.late)('lists a newly published entry without a restart', async () => {
    const late = /** @type {NonNullable<RecipeCase['late']>} */ (recipe.late);
    const before = await (await fetchWithHost(`${base}/llms.txt`, HOST)).text();
    expect(before).not.toMatch(late.match);
    const { file, directory } = lateSeed(root, late.collection);
    try {
      run(root, [EMDASH_BIN, 'seed', file, '--on-conflict', 'skip', ...databaseArgs]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    // emdashAeo() re-lists the catalog once its 10 second revalidate window passes.
    let body = before;
    for (let attempt = 0; attempt < 40 && !late.match.test(body); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      body = await (await fetchWithHost(`${base}/llms.txt`, HOST)).text();
    }
    expect(body).toMatch(late.match);
    const path = /** @type {RegExpMatchArray} */ (body.match(late.match))[0].slice(1, -4);
    expect((await fetch(`${base}${path}`)).status).toBe(200);
  }, 60_000);
});

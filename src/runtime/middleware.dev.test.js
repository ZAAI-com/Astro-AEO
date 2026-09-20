import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = join(REPO, 'fixtures', 'demo');
const PORT = 4329;

// Resolve Astro's CLI entry from its own bin field so this works across major
// versions (Astro 5 ships astro.js, Astro 7 ships bin/astro.mjs).
const astroDir = join(REPO, 'node_modules', 'astro');
const astroBinField = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).bin;
const astroBin = join(astroDir, typeof astroBinField === 'string' ? astroBinField : astroBinField.astro);
// 127.0.0.1, not "localhost": Node's fetch resolves localhost to ::1, but the
// Astro dev server binds IPv4, so localhost would never connect under Vitest.
const BASE = `http://127.0.0.1:${PORT}`;

// Astro warns, and keeps warning, when a prerendered route touches
// `Astro.request.headers` (core/request.js installs the getter that logs it). That
// warning is the only observable proof that our middleware did not read them, so the
// needle is read out of the installed Astro rather than hard-coded: if a future major
// rewords or drops the warning, this throws at import instead of turning the
// assertion below into one that can never fail.
const HEADER_WARNING = 'is not available on prerendered pages';
const astroRequestSource = readFileSync(join(astroDir, 'dist', 'core', 'request.js'), 'utf8');
// Created before the dev server starts and removed in afterAll. It lives under the
// demo's /private/** exclusion so it can never reach an AEO artifact.
const PROBE_PAGE = join(DEMO, 'src', 'pages', 'private', 'headers-probe.astro');
if (!astroRequestSource.includes(HEADER_WARNING)) {
  throw new Error(
    `astro ${JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8')).version} no longer warns ` +
    `with ${JSON.stringify(HEADER_WARNING)} when a prerendered route reads request headers. ` +
    'Find the current wording in astro/dist/core/request.js and update HEADER_WARNING, ' +
    'or this test proves nothing.',
  );
}

/** @type {import('node:child_process').ChildProcess} */
let server;
let serverOutput = '';
let serverOutputRevision = 0;
/** @type {Error | undefined} */
let serverStartError;

// The dev server colourises its request log whenever CI is set, which puts an
// escape sequence between "[200]" and the pathname. Strip it once, here, so every
// pattern, assertion, and diagnostic dump below reads plain text.
const ANSI = /\u001B\[[0-9;]*m/g;

/** @param {string | Buffer} chunk */
function captureServerOutput(chunk) {
  serverOutput += chunk.toString().replace(ANSI, '');
  serverOutputRevision += 1;
}

function serverDiagnostics() {
  const output = serverOutput.trimEnd();
  return output
    ? `\nDev server output:\n${output}`
    : '\nThe dev server produced no output.';
}

function assertServerRunning(label) {
  if (serverStartError) {
    throw new Error(`${label}: ${serverStartError.message}${serverDiagnostics()}`);
  }
  if (server.exitCode !== null || server.signalCode !== null) {
    throw new Error(
      `${label}: dev server exited with code ${server.exitCode ?? 'null'} and signal ${server.signalCode ?? 'null'}.${serverDiagnostics()}`,
    );
  }
}

async function waitForReady(timeoutMs = 30000) {
  const start = Date.now();
  let lastFailure = 'no HTTP response received';
  while (Date.now() - start < timeoutMs) {
    assertServerRunning('Dev server failed before becoming ready');
    try {
      const r = await fetch(`${BASE}/`);
      await r.body?.cancel();
      if (r.ok) return;
      lastFailure = `last readiness response was HTTP ${r.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(
    `Dev server did not become ready in ${timeoutMs}ms: ${lastFailure}.${serverDiagnostics()}`,
  );
}

/** @param {RegExp} pattern @param {number} startAt @param {number} [timeoutMs] */
async function waitForServerOutput(pattern, startAt, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertServerRunning(`Dev server stopped while waiting for output matching ${pattern}`);
    const output = serverOutput.slice(startAt);
    if (pattern.test(output)) return output;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for dev server output matching ${pattern}.${serverDiagnostics()}`,
  );
}

async function waitForServerOutputToDrain(quietMs = 200, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let revision = serverOutputRevision;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    assertServerRunning('Dev server stopped while its output was draining');
    if (serverOutputRevision !== revision) {
      revision = serverOutputRevision;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Dev server output did not drain in ${timeoutMs}ms.${serverDiagnostics()}`);
}

/** @param {string} url @param {number} [timeoutMs] */
async function fetchUntilOk(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    assertServerRunning(`Dev server stopped while waiting for ${url}`);
    try {
      const response = await fetch(url);
      await response.body?.cancel();
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} never returned a 2xx: ${lastStatus}.${serverDiagnostics()}`);
}

beforeAll(async () => {
  // Give the child a clean env: Vitest injects NODE_OPTIONS and VITEST* vars that
  // break the child's own Vite (it prints "ready" but never binds). ASTRO_DEV_BACKGROUND
  // keeps Astro 7's dev server in the foreground so we can tear it down in afterAll.
  // Astro's route manifest is built at startup, so the control page below has to
  // exist before the server spawns.
  writeFileSync(
    PROBE_PAGE,
    "---\nconst accept = Astro.request.headers.get('accept');\n---\n<html><body><p>{accept}</p></body></html>\n",
  );
  const childEnv = { ...process.env, ASTRO_DEV_BACKGROUND: '1' };
  delete childEnv.NODE_OPTIONS;
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('VITEST') || key.startsWith('__VITEST') || key.startsWith('TINYPOOL')) delete childEnv[key];
  }
  server = spawn(
    'node',
    // --host 127.0.0.1 pins the dev server to IPv4 loopback so it matches BASE.
    [astroBin, 'dev', '--root', DEMO, '--host', '127.0.0.1', '--port', String(PORT)],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
  );
  server.stdout?.setEncoding('utf8');
  server.stderr?.setEncoding('utf8');
  server.stdout?.on('data', captureServerOutput);
  server.stderr?.on('data', captureServerOutput);
  server.on('error', (error) => {
    serverStartError = error;
  });
  await waitForReady();
});

afterAll(() => {
  rmSync(PROBE_PAGE, { force: true });
  if (server) server.kill('SIGKILL');
});

describe('dev server AEO endpoints', () => {
  test('serves a .md companion converted on the fly', async () => {
    const r = await fetch(`${BASE}/about.md`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/markdown');
    const body = await r.text();
    expect(body).toContain('# About');
  });

  test('serves robots.txt and domain-profile.json', async () => {
    const robots = await fetch(`${BASE}/robots.txt`);
    expect(robots.status).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain('User-agent: Googlebot');
    // @astrojs/sitemap only writes during builds, so automatic mode must not
    // advertise its build-only output from the live dev server.
    expect(robotsBody).not.toContain('Sitemap:');

    const dp = await fetch(`${BASE}/.well-known/domain-profile.json`);
    expect(dp.status).toBe(200);
    expect((await dp.json()).name).toBe('Astro-AEO Demo');
  });

  test('serves llms.txt for static routes with a dev-preview note', async () => {
    const r = await fetch(`${BASE}/llms.txt`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('## Home');
    expect(body).toContain('development preview');
  });

  test('automatically enumerates prerendered dynamic routes in aggregate corpora', async () => {
    const llms = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(llms).toContain('/dynamic/alpha.md');
    expect(llms).toContain('/archive/2026/launch.md');
    expect(llms).toContain('/paged/2.md');
    const full = await (await fetch(`${BASE}/llms-full.txt`)).text();
    expect(full).toContain('Body for the alpha dynamic route.');
    expect(full).toContain('Nested archive route body.');
    expect(full).toContain('Items: three.');
  });

  test('serves a direct dynamic Markdown companion without building the inventory', async () => {
    const response = await fetch(`${BASE}/dynamic/alpha.md`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Alpha Dynamic');
  });

  test('excluded pages are not served as .md nor listed in llms.txt', async () => {
    // The demo config excludes /private/** from AEO output.
    const md = await fetch(`${BASE}/private/secret.md`);
    expect(md.status).toBe(404);
    const llms = await (await fetch(`${BASE}/llms.txt`)).text();
    // Positive control: an llms.txt that failed to list anything would satisfy the
    // exclusion assertion on its own.
    expect(llms).toContain('/about.md');
    expect(llms).not.toContain('/private/secret');
  });

  // The dev server and the build used to build these strings separately and had
  // drifted apart on three settings. They now share one renderer; these assert it.
  describe('parity with the build', () => {
    test('.md frontmatter carries lastModified, which dev used to drop', async () => {
      // The demo enables markdown.frontmatter, and this post declares
      // article:modified_time. Dev previously emitted no lastModified at all.
      const body = await (await fetch(`${BASE}/blog/first-post.md`)).text();
      expect(body).toMatch(/^---\n/);
      expect(body).toContain('title: "First Post"');
      expect(body).toContain('lastModified: 2026-02-15');
    });

    test('llms.txt honours showLastModified, which dev used to ignore', async () => {
      const body = await (await fetch(`${BASE}/llms.txt`)).text();
      expect(body).toContain('_(updated 2026-02-15)_');
    });

    test('llms-full.txt honours the mode, which dev used to ignore', async () => {
      const body = await (await fetch(`${BASE}/llms-full.txt`)).text();
      // The demo leaves mode at 'all', so every eligible page is inlined.
      expect(body).toContain('# First Post');
      expect(body).toContain('# About');
      expect(body).toContain('URL: https://demo.example.com/about/');
      // no-llms-full and excluded pages stay out regardless of mode.
      expect(body).not.toContain('/private/secret');
    });

    test('a no-dotmd page is refused as .md in dev, exactly as the build omits it', async () => {
      expect((await fetch(`${BASE}/no-md.md`)).status).toBe(404);
    });
  });
});

describe('request-time contract', () => {
  test('a prerendered route enriches HTML without reading request headers', async () => {
    // Astro blanks request headers for prerendered routes (core/request.js), on
    // purpose: those pages are static files in production, so honouring an Accept
    // header would work in dev and silently stop working once deployed. Content
    // negotiation is therefore an on-demand-route feature, and the demo is static.
    // The negotiation predicate itself is unit-tested in runtime/negotiate.test.js.
    const outputStart = serverOutput.length;
    const r = await fetch(`${BASE}/about/`, { headers: { accept: 'text/markdown' } });
    const body = await r.text();
    await waitForServerOutput(/\[200\]\s+\/about\//, outputStart);
    await waitForServerOutputToDrain();

    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const vary = r.headers.get('vary')
      ?.split(',')
      .map((value) => value.trim().toLowerCase()) ?? [];
    expect(vary).not.toContain('accept');
    expect(body).toContain('<link rel="alternate" type="text/markdown" href="/about.md">');
    expect(body).toContain('data-astro-aeo-graph');
    expect(body).toContain('"@type":"BreadcrumbList"');
    // waitForServerOutput above already proved this request's log reached serverOutput,
    // so Astro's prerendered-headers warning would be in the same slice had the
    // middleware read them.
    const log = serverOutput.slice(outputStart);
    expect(log).toMatch(/\[200\]\s+\/about\//);
    expect(log).not.toContain(HEADER_WARNING);
  });

  // Control for the assertion above: the warning is only worth asserting on if this
  // dev server really does emit it. A page that does read the headers must produce it,
  // through the same capture and the same slice arithmetic.
  test('a prerendered route that does read request headers is logged, so the check above can fail', async () => {
    const outputStart = serverOutput.length;
    await fetchUntilOk(`${BASE}/private/headers-probe/`);
    await waitForServerOutput(new RegExp(HEADER_WARNING.replace(/ /g, '\\s+')), outputStart, 10000);
  });

  test('a .md response carries an ETag that satisfies a conditional request', async () => {
    const first = await fetch(`${BASE}/about.md`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${BASE}/about.md`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  test('HEAD returns the same headers with no body', async () => {
    const head = await fetch(`${BASE}/about.md`, { method: 'HEAD' });
    const get = await fetch(`${BASE}/about.md`);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(await head.text()).toBe('');
  });

  test('Range and compression preferences cannot turn generated Markdown into a partial response', async () => {
    const response = await fetch(`${BASE}/about.md`, {
      headers: { 'accept-encoding': 'gzip', range: 'bytes=0-9' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('accept-ranges')).toBeNull();
    expect(await response.text()).toContain('# About');
  });

  test('a POST is never intercepted', async () => {
    const r = await fetch(`${BASE}/about.md`, { method: 'POST' });
    expect(r.status).not.toBe(200);
  });

  test('a .md path for a page that does not exist is a 404, not someone else HTML', async () => {
    const r = await fetch(`${BASE}/does-not-exist.md`);
    expect(r.status).toBe(404);
  });
});

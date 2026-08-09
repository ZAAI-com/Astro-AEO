#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcessTree, stopProcessTree } from './process-tree.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodePort = 4581;
const cloudflarePort = 4582;
const origin = `http://127.0.0.1:${nodePort}`;
const astroBin = resolve(root, 'node_modules/astro/bin/astro.mjs');
const wranglerBin = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

for (const adapter of ['node', 'cloudflare']) rebuildAdapter(adapter);

const entry = resolve(root, 'fixtures/adapters/node/dist/server/entry.mjs');
const server = spawnProcessTree(process.execPath, [entry], {
  cwd: resolve(root, 'fixtures/adapters/node'),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(nodePort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));
const cloudflare = spawnProcessTree(
  process.execPath,
  [
    resolve(root, 'node_modules/astro/bin/astro.mjs'),
    'preview',
    '--root',
    resolve(root, 'fixtures/adapters/cloudflare'),
    '--host',
    '127.0.0.1',
    '--port',
    String(cloudflarePort),
  ],
  {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let cloudflareOutput = '';
cloudflare.stdout.on('data', (chunk) => (cloudflareOutput += chunk));
cloudflare.stderr.on('data', (chunk) => (cloudflareOutput += chunk));

try {
  await Promise.all([
    waitForServer(`${origin}/docs/about/`, server, () => output),
    waitForCloudflarePreview(
      `http://127.0.0.1:${cloudflarePort}/docs/about/`,
      cloudflare,
      () => cloudflareOutput,
    ),
  ]);
  await stop(cloudflare);
  const cloudflareStartupMs = measureCloudflareStartup();
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      'benchmarks/run.mjs',
      '--enforce',
      '--require-complete',
      '--request-origin',
      origin,
      '--html-path',
      '/docs/about/',
      '--markdown-path',
      '/docs/about.md',
      '--node-bundle',
      'fixtures/adapters/node/dist/server',
      '--node-baseline-bundle',
      'fixtures/benchmarks/node-baseline/dist/server',
      '--cloudflare-bundle',
      'fixtures/adapters/cloudflare/dist/server',
      '--cloudflare-baseline-bundle',
      'fixtures/benchmarks/cloudflare-baseline/dist/server',
      '--cloudflare-startup-ms',
      String(cloudflareStartupMs),
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await Promise.all([stop(server), stop(cloudflare)]);
}

async function waitForServer(url, child, readOutput) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Node benchmark server exited with ${child.exitCode}:\n${readOutput()}`);
    }
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // The socket is not accepting requests yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Node benchmark server did not become ready:\n${readOutput()}`);
}

async function waitForCloudflarePreview(url, child, readOutput) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const output = readOutput();
    if (child.exitCode !== null) {
      throw new Error(`Cloudflare preview exited with ${child.exitCode}:\n${output}`);
    }
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Workerd is not accepting requests yet.
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Cloudflare workerd-backed preview did not report readiness:\n${readOutput()}`);
}

function measureCloudflareStartup() {
  const profile = resolve(root, '.astro/aeo-benchmarks/cloudflare-startup.cpuprofile');
  mkdirSync(dirname(profile), { recursive: true });
  rmSync(profile, { force: true });
  const result = spawnSync(
    process.execPath,
    [
      wranglerBin,
      'check',
      'startup',
      '--cwd',
      resolve(root, 'fixtures/adapters/cloudflare'),
      '--config',
      'dist/server/wrangler.json',
      '--args=--no-bundle',
      '--outfile',
      profile,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(`Cloudflare startup profiling failed:\n${output}`);
  const active = output.match(/\bActive:\s+([0-9.]+)\s*ms\b/i);
  if (!active) throw new Error(`Cloudflare startup profile did not report active time:\n${output}`);
  return Number(active[1]);
}

async function stop(child) {
  await stopProcessTree(child);
}

function rebuildAdapter(adapter) {
  const fixture = resolve(root, 'fixtures/adapters', adapter);
  for (const generated of ['dist', '.wrangler']) {
    rmSync(resolve(fixture, generated), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  const result = spawnSync(process.execPath, [astroBin, 'build', '--root', fixture], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${adapter} benchmark fixture build failed with ${result.status ?? 'no status'}`);
  }
}

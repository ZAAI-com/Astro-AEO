import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/starlight-node');
const PORT = 4473;
const SITE_HOST = 'starlight-node.example.com';

const astroPkg = JSON.parse(readFileSync(join(REPO, 'node_modules/astro/package.json'), 'utf8'));
const astroBin = join(REPO, 'node_modules/astro', typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro);

let server;

/** @param {string} path @param {Record<string, string>} [headers] */
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: '127.0.0.1', port: PORT, path, headers: { host: SITE_HOST, ...headers } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

beforeAll(async () => {
  execFileSync('node', [astroBin, 'build', '--root', FIXTURE], { cwd: REPO, stdio: 'ignore' });
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) };
  for (const key of Object.keys(env)) {
    if (/^(VITEST|__VITEST|TINYPOOL)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  server = spawn('node', [join(FIXTURE, 'dist/server/entry.mjs')], { cwd: REPO, env, stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try {
      await get('/');
      break;
    } catch (error) {
      if (attempt > 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
});

afterAll(() => {
  server?.kill();
});

describe('Starlight plugin on demand', () => {
  test('a visitor never receives the inferred source marker', async () => {
    const response = await get('/guides/install/');
    expect(response.status).toBe(200);
    expect(response.body).toContain('Run the installer.');
    expect(response.body).not.toContain('data-astro-aeo-marker');
    expect(response.body).not.toContain('application/vnd.astro-aeo+json');
  });

  test('the Markdown companion is the authored source with labeled asides', async () => {
    const response = await get('/guides/install.md');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/markdown/);
    expect(response.body).toContain('# Install');
    expect(response.body).toContain('> **Caution: Back up first**');
    expect(response.body).not.toContain('data-astro-aeo-marker');
  });

  test('unconvertible MDX falls back to the rendered content region', async () => {
    const response = await get('/guides/dynamic.md');
    expect(response.status).toBe(200);
    expect(response.body).toContain('The rendered year is 2026.');
    expect(response.body).not.toContain('export const');
  });

  test('content negotiation serves the same companion', async () => {
    const response = await get('/guides/install/', { accept: 'text/markdown' });
    expect(response.headers['content-type']).toMatch(/^text\/markdown/);
    expect(response.body).toContain('> **Caution: Back up first**');
  });
});

// @ts-check
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { END_MARKER, START_MARKER, fixHeadersFile } from './headers.js';
import { FixRefusal, detectProviders, runFix } from './index.js';
import { fixRenderYaml } from './render-yaml.js';
import { fixVercelJson } from './vercel-json.js';

const MIME = 'text/markdown; charset=utf-8';
/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** @param {Record<string, string>} files */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-aeo-fix-'));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  return root;
}

/** Every file under `root`, so "nothing was written" is a statement about the whole tree. @param {string} root @returns {string[]} */
function tree(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tree(root, join(prefix, entry.name)) : [join(prefix, entry.name)]).sort();
}

describe('_headers', () => {
  test('creates the managed block in an empty file', () => {
    expect(fixHeadersFile('')).toEqual({
      status: 'changed',
      text: `${START_MARKER}\n/*.md\n  Content-Type: ${MIME}\n${END_MARKER}\n`,
    });
  });

  test('appends after existing rules and keeps every other byte, including CRLF', () => {
    const before = '# mine\r\n/assets/*\r\n  Cache-Control: max-age=600\r\n';
    const { text } = fixHeadersFile(before);
    expect(text.startsWith(before)).toBe(true);
    expect(text).toBe(`${before}\r\n${START_MARKER}\r\n/*.md\r\n  Content-Type: ${MIME}\r\n${END_MARKER}\r\n`);
    expect(text).not.toMatch(/[^\r]\n/);
  });

  test('is idempotent, and repairs a block someone edited', () => {
    const once = fixHeadersFile('/x\n  A: b').text;
    expect(fixHeadersFile(once)).toEqual({ status: 'unchanged', text: once });
    const edited = once.replace(MIME, 'text/plain');
    expect(fixHeadersFile(edited).text).toBe(once);
  });

  test.each([
    ['a duplicated start marker', `${START_MARKER}\n${START_MARKER}\n${END_MARKER}\n`],
    ['an unpaired marker', `${START_MARKER}\n/*.md\n`],
    ['markers out of order', `${END_MARKER}\n${START_MARKER}\n`],
    ['a competing rule outside the block', '/*.md\n  Content-Type: text/plain\n'],
    ['a competing Content-Type for a .md path', '/docs/*.md\n  X-A: b\n  content-type: text/plain\n'],
  ])('refuses %s', (_label, text) => {
    expect(() => fixHeadersFile(text)).toThrow(FixRefusal);
  });
});

describe('vercel.json', () => {
  test('creates a document, and keeps unknown fields, key order and indentation', () => {
    expect(JSON.parse(fixVercelJson('').text)).toEqual({ headers: [{ source: '/(.*)\\.md', headers: [{ key: 'Content-Type', value: MIME }] }] });
    const before = '{\n\t"cleanUrls": true,\n\t"future": { "x": [1, 2] },\n\t"headers": [{ "source": "/a", "headers": [] }]\n}\n';
    const { text } = fixVercelJson(before);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual(['cleanUrls', 'future', 'headers']);
    expect(parsed.future).toEqual({ x: [1, 2] });
    expect(parsed.headers).toHaveLength(2);
    expect(text).toContain('\n\t"cleanUrls"');
    expect(text.endsWith('}\n')).toBe(true);
  });

  test('is idempotent and corrects a wrong value in its own rule', () => {
    const once = fixVercelJson('{}').text;
    expect(fixVercelJson(once).status).toBe('unchanged');
    expect(fixVercelJson(once.replace(MIME, 'text/plain')).text).toBe(once);
  });

  test.each([
    ['comments', '{ // no\n}'],
    ['a non-object', '[]'],
    ['a non-array headers', '{"headers": {}}'],
    ['a conditional rule on the same source', '{"headers":[{"source":"/(.*)\\\\.md","has":[{"type":"host","value":"x"}],"headers":[]}]}'],
    ['another .md pattern setting Content-Type', '{"headers":[{"source":"/docs/(.*).md","headers":[{"key":"content-type","value":"text/plain"}]}]}'],
  ])('refuses %s', (_label, text) => {
    expect(() => fixVercelJson(text)).toThrow(FixRefusal);
  });
});

describe('render.yaml', () => {
  const yaml = [
    '# top comment',
    'shared: &shared',
    '  plan: free',
    'services:',
    '  - type: web',
    '    name: site # the docs',
    '    runtime: static',
    '    <<: *shared',
    '    futureField: kept',
    '    staticPublishPath: ./dist',
    '  - type: web',
    '    name: api',
    '    runtime: node',
    '',
  ].join('\n');

  test('adds the rule and keeps comments, anchors and unknown fields', async () => {
    const { text } = await fixRenderYaml(yaml);
    for (const kept of ['# top comment', '&shared', '<<: *shared', 'name: site # the docs', 'futureField: kept', 'name: api']) expect(text).toContain(kept);
    expect(text).toContain(`path: /*.md`);
    expect(text).toContain(`value: ${MIME}`);
    expect((await fixRenderYaml(text)).status).toBe('unchanged');
  });

  test('appends to an existing headers list and corrects its own rule', async () => {
    const withHeaders = yaml.replace('    staticPublishPath: ./dist', '    staticPublishPath: ./dist\n    headers:\n      - path: /*\n        name: X-Frame-Options\n        value: DENY');
    const { text } = await fixRenderYaml(withHeaders);
    expect(text).toContain('X-Frame-Options');
    expect(text.match(/- path:/g)).toHaveLength(2);
    expect((await fixRenderYaml(text.replace(MIME, 'text/plain'))).text).toBe(text);
  });

  test('refuses several static services until one is named', async () => {
    const two = `${yaml}  - type: web\n    name: blog\n    runtime: static\n`;
    await expect(fixRenderYaml(two)).rejects.toThrow(/several static site services \(site, blog\)/);
    expect((await fixRenderYaml(two, { service: 'blog' })).text).toMatch(/name: blog[\s\S]*path: \/\*\.md/);
    await expect(fixRenderYaml(two, { service: 'nope' })).rejects.toThrow(/no static site service named/);
  });

  test.each([
    ['several documents', 'a: 1\n---\nb: 2\n'],
    ['a parse error', 'services: [\n'],
    ['no services', 'databases: []\n'],
    ['no static service', 'services:\n  - type: web\n    runtime: node\n'],
  ])('refuses %s', async (_label, text) => {
    await expect(fixRenderYaml(text)).rejects.toThrow(FixRefusal);
  });
});

describe('astro-aeo fix', () => {
  test('a dry run leaves the whole tree untouched', async () => {
    const root = project({ 'netlify.toml': '[build]\n', 'public/_headers': '/a\n  B: c\n' });
    const before = tree(root);
    const result = await runFix([root]);
    expect(result).toMatchObject({ changed: true, written: false });
    expect(result.output).toContain('dry run');
    expect(result.output).toContain('+ /*.md');
    expect(tree(root)).toEqual(before);
    expect(readFileSync(join(root, 'public/_headers'), 'utf8')).toBe('/a\n  B: c\n');
  });

  test('--write applies once with one mode-preserving backup, and a second run is a no-op', async () => {
    const root = project({ 'vercel.json': '{\n  "cleanUrls": true\n}\n' });
    chmodSync(join(root, 'vercel.json'), 0o640);
    const first = await runFix([root, '--write'], { now: new Date('2026-09-21T10:20:30.456Z') });
    expect(first).toMatchObject({ changed: true, written: true });
    const backup = join(root, '.astro/aeo-backups/20260921T102030Z/vercel.json');
    expect(readFileSync(backup, 'utf8')).toBe('{\n  "cleanUrls": true\n}\n');
    if (process.platform !== 'win32') {
      expect(statSync(backup).mode & 0o777).toBe(0o640);
      expect(statSync(join(root, 'vercel.json')).mode & 0o777).toBe(0o640);
    }
    const written = readFileSync(join(root, 'vercel.json'), 'utf8');
    const second = await runFix([root, '--write'], { now: new Date('2026-09-21T10:20:31Z') });
    expect(second).toMatchObject({ changed: false, written: false });
    expect(readFileSync(join(root, 'vercel.json'), 'utf8')).toBe(written);
    expect(readdirSync(join(root, '.astro/aeo-backups'))).toEqual(['20260921T102030Z']);
  });

  test('creates a missing _headers file without a backup', async () => {
    const root = project({ 'wrangler.jsonc': '{}' });
    await runFix([root, '--write']);
    expect(readFileSync(join(root, 'public/_headers'), 'utf8')).toContain('/*.md');
    expect(existsSync(join(root, '.astro'))).toBe(false);
  });

  test('Cloudflare and Netlify share one target, so both together are not ambiguous', async () => {
    const root = project({ 'wrangler.toml': '', 'netlify.toml': '' });
    expect(detectProviders(root)).toEqual(['cloudflare', 'netlify']);
    expect((await runFix([root])).changed).toBe(true);
  });

  test.each([
    ['no provider', {}, [], /no supported provider configuration/],
    ['ambiguous providers', { 'vercel.json': '{}', 'netlify.toml': '' }, [], /several providers \(netlify, vercel\)/],
    ['an unknown provider', { 'vercel.json': '{}' }, ['--provider', 'fastly'], /--provider must be one of/],
    ['a missing render.yaml', {}, ['--provider', 'render'], /render\.yaml does not exist/],
    ['a malformed document', { 'vercel.json': '{' }, ['--write'], /not valid JSON/],
  ])('refuses %s and writes nothing', async (_label, files, args, message) => {
    const root = project(/** @type {Record<string, string>} */ (files));
    const before = tree(root);
    await expect(runFix([root, ...args])).rejects.toThrow(message);
    expect(tree(root)).toEqual(before);
  });

  test('refuses a symlinked target and a symlinked directory on the way to it', async () => {
    const outside = project({ 'real_headers': '/x\n', 'realpublic/_headers': '/y\n' });
    const linkedFile = project({ 'netlify.toml': '' });
    mkdirSync(join(linkedFile, 'public'));
    symlinkSync(join(outside, 'real_headers'), join(linkedFile, 'public/_headers'));
    await expect(runFix([linkedFile, '--write'])).rejects.toThrow(/symbolic link|not a regular file/);
    const linkedDir = project({ 'netlify.toml': '' });
    symlinkSync(join(outside, 'realpublic'), join(linkedDir, 'public'));
    await expect(runFix([linkedDir, '--write'])).rejects.toThrow(/symbolic link/);
    expect(readFileSync(join(outside, 'real_headers'), 'utf8')).toBe('/x\n');
    expect(readFileSync(join(outside, 'realpublic/_headers'), 'utf8')).toBe('/y\n');
  });

  test('refuses a public directory outside the project', async () => {
    const root = project({ 'netlify.toml': '' });
    await expect(runFix([root, '--public-dir', '../elsewhere', '--write'])).rejects.toThrow(/outside the project/);
  });

  test.each(['nginx', 'apache', 'node', 'workers', 'deno'])('prints a snippet for %s and never writes', async (provider) => {
    const root = project({});
    const result = await runFix([root, '--provider', provider, '--write']);
    expect(result).toMatchObject({ changed: false, written: false });
    expect(result.output).toContain('text/markdown');
    expect(tree(root)).toEqual([]);
  });
});

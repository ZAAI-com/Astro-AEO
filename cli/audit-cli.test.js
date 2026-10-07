// @ts-check
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AuditInvocationError, runAudit } from './audit.js';

const BIN = resolve('bin/astro-aeo.js');
const VALID = resolve('fixtures/dist-valid');
const BROKEN = resolve('fixtures/dist-broken');
/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** @param {string[]} args @param {string} [cwd] */
const audit = (args, cwd) => spawnSync(process.execPath, [BIN, 'audit', ...args], { encoding: 'utf8', ...(cwd ? { cwd } : {}) });

describe('audit CLI', () => {
  test.each([
    ['dist-valid', VALID, []],
    ['dist-valid --fail-on warning', VALID, ['--fail-on', 'warning']],
    ['dist-broken', BROKEN, []],
    ['dist-broken --fail-on none', BROKEN, ['--fail-on', 'none']],
  ])('a junit report of %s fails a case exactly when the audit exits 1', (_name, target, flags) => {
    const result = audit([target, '--format', 'junit', ...flags]);
    expect([0, 1]).toContain(result.status);
    const failing = /<failure /.test(result.stdout);
    expect(failing).toBe(result.status === 1);
    expect(/<testsuites [^>]*failures="0"/.test(result.stdout)).toBe(result.status === 0);
  });

  test('validate --strict and audit accept the robots.txt Astro-AEO writes with Content Signals', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'astro-aeo-content-signals-')));
    roots.push(root);
    const dist = join(root, 'dist');
    cpSync(VALID, dist, { recursive: true });
    const robots = readFileSync(join(VALID, 'robots.txt'), 'utf8').replace(
      /^(Allow: \/)$/gm,
      '$1\n# Experimental Content Signals, not part of RFC 9309\nContent-Signal: search=yes, ai-input=yes, ai-train=no',
    );
    expect(robots.match(/Content-Signal:/g)).toHaveLength(2);
    writeFileSync(join(dist, 'robots.txt'), robots);

    const validate = spawnSync(process.execPath, [BIN, 'validate', dist, '--strict'], { encoding: 'utf8' });
    expect(validate.status, validate.stdout + validate.stderr).toBe(0);
    const report = JSON.parse(audit([dist, '--format', 'json', '--fail-on', 'none']).stdout);
    expect(report.findings.filter((finding) => finding.ruleId === 'robots-unknown-line')).toEqual([]);
  });

  test('refuses a symlinked build root with invocation status 2', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'astro-aeo-audit-cli-')));
    roots.push(root);
    symlinkSync(VALID, join(root, 'linked-dist'));
    const result = audit([join(root, 'linked-dist')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('symbolic link');
    expect(result.stdout).toBe('');
  });

  test.each(['http', 'network', 'body'])('fails on a %s companion error unless --fail-on none', async (failure) => {
    const fetch = /** @type {typeof globalThis.fetch} */ (async (input) => {
      if (String(input).endsWith('.md')) {
        if (failure === 'http') return new Response('missing', { status: 404 });
        if (failure === 'network') throw new Error('unreachable');
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } }));
      }
      return new Response('<html lang="en"><head><title>Home</title><meta name="description" content="Home"><link rel="alternate" type="text/markdown" href="/index.md"></head></html>', { headers: { 'content-type': 'text/html' } });
    });
    const context = { version: '1.4.0', fetch };
    const result = await runAudit(['https://example.com/', '--format', 'json'], context);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.output).summary).toMatchObject({ errors: 1, pagesChecked: 1 });
    expect((await runAudit(['https://example.com/', '--fail-on', 'none'], context)).exitCode).toBe(0);
  });

  test('maps a failed starting response body to an invocation error', async () => {
    const fetch = /** @type {typeof globalThis.fetch} */ (async () => new Response(
      new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } }),
      { headers: { 'content-type': 'text/html' } },
    ));
    await expect(runAudit(['https://example.com/'], { version: '1.4.0', fetch })).rejects.toBeInstanceOf(AuditInvocationError);
  });

  test('exits 0 on warnings by default and 1 under --fail-on warning', () => {
    expect(audit([VALID]).status).toBe(0);
    expect(audit([VALID, '--fail-on', 'warning']).status).toBe(1);
  });

  test('exits 1 on errors, and 0 under --fail-on none', () => {
    const failed = audit([BROKEN]);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('[missing-md]');
    expect(audit([BROKEN, '--fail-on', 'none']).status).toBe(0);
  });

  test('scores never change the exit status', () => {
    const scored = audit([BROKEN, '--format', 'json']);
    const plain = audit([BROKEN, '--format', 'json', '--no-score']);
    expect(scored.status).toBe(plain.status);
    expect(JSON.parse(scored.stdout).scores.rubric).toBe('astro-aeo-readiness-v2');
    const report = JSON.parse(plain.stdout);
    expect(report.scores).toBeUndefined();
    expect(report.findings.some((/** @type {any} */ finding) => 'deduction' in finding)).toBe(false);
  });

  test.each([
    [['--format', 'pdf'], '--format must be'],
    [['--fail-on', 'info'], '--fail-on must be'],
    [['--bogus'], 'Unknown option'],
    [[VALID, BROKEN], 'at most one'],
    [['no-such-dir'], 'build directory not found'],
    [[VALID, '--concurrency', '4'], '--concurrency applies only when the target is a URL'],
    [[VALID, '--allow-origin', 'https://x.example'], '--allow-origin applies only'],
    [['https://example.com/', '--concurrency', '33'], 'from 1 to 32'],
    [['https://example.com/', '--max-pages', '0'], '--max-pages must be'],
    [['https://example.com/', '--base', '/docs'], '--base applies to a build directory'],
    [['https://user:pw@example.com/'], 'credentials'],
  ])('exits 2 for the bad invocation %j', (args, message) => {
    const result = audit(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe('');
  });

  test('exits 2 when the target URL cannot be reached', () => {
    const result = audit(['http://127.0.0.1:9/', '--timeout', '500']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not audit');
  });
  test('rejects an unknown schema target with invocation status 2', () => {
    const result = audit([VALID, '--schema-target', 'bing']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--schema-target must be schema or google');
  });
  test('keeps editorial advice score-neutral and applies Google warning gates', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'astro-aeo-opt-in-')));
    roots.push(root);
    const html = '<html lang="en"><head><title>How to publish</title><meta name="description" content="Publishing guide"><script type="application/ld+json">{"@type":"Product","name":"Tool"}</script></head><body><main><h1>How to publish</h1><p>42% agree.</p></main></body></html>';
    writeFileSync(join(root, 'index.html'), html);
    const context = { version: '1.5.3', fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) };
    const baseline = await runAudit([root, '--format', 'json'], context);
    const editorial = await runAudit([root, '--heuristics', '--format', 'json'], context);
    expect(editorial.exitCode).toBe(baseline.exitCode);
    expect(JSON.parse(editorial.output).scores).toMatchObject({ overall: JSON.parse(baseline.output).scores.overall });
    const added = JSON.parse(editorial.output).findings.filter((finding) => finding.ruleId.startsWith('editorial-'));
    expect(added.map((finding) => finding.ruleId).sort()).toEqual(['editorial-howto-structure', 'editorial-unsourced-number']);
    expect(added.find((finding) => finding.ruleId === 'editorial-howto-structure').message).toContain('ordered list');
    expect(added.find((finding) => finding.ruleId === 'editorial-unsourced-number').message).toContain('source link');
    expect(added.every((finding) => finding.severity === 'info' && finding.deduction === 0)).toBe(true);
    const live = await runAudit(['https://example.com/', '--heuristics', '--schema-target', 'google', '--format', 'json'], context);
    const local = await runAudit([root, '--heuristics', '--schema-target', 'google', '--format', 'json'], context);
    const comparable = (result) => JSON.parse(result.output).findings.filter((finding) => /^(editorial|google)-/.test(finding.ruleId)).map(({ ruleId, severity, message }) => ({ ruleId, severity, message }));
    expect(comparable(live)).toEqual(comparable(local));
    expect((await runAudit([root, '--schema-target', 'google', '--fail-on', 'warning'], context)).exitCode).toBe(1);
    expect(JSON.parse(local.output).scores.overall).toBeLessThan(JSON.parse(editorial.output).scores.overall);
    for (const format of ['terminal', 'json', 'sarif', 'html', 'markdown', 'github', 'junit']) {
      const result = await runAudit([root, '--heuristics', '--schema-target', 'google', '--format', format], context);
      expect(result.output, format).toContain('editorial-unsourced-number');
      expect(result.output, format).toContain('google-schema-required');
    }
  });

  test('records the target relative to the working directory, never absolute', () => {
    const report = JSON.parse(audit([VALID, '--format', 'json']).stdout);
    expect(report.target).toEqual({ kind: 'dist', value: 'fixtures/dist-valid' });
    expect(JSON.stringify(report)).not.toContain(process.cwd());
  });

  test('--output writes the whole report atomically and keeps stdout empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-audit-cli-'));
    roots.push(root);
    const result = audit([BROKEN, '--format', 'sarif', '--output', 'reports/out.sarif'], root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(readFileSync(join(root, 'reports/out.sarif'), 'utf8')).version).toBe('2.1.0');
    expect(readdirSync(join(root, 'reports'))).toEqual(['out.sarif']);
  });

  test('--output to an unwritable place exits 2 and leaves no temporary file', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-audit-cli-'));
    roots.push(root);
    writeFileSync(join(root, 'blocker'), 'x');
    const result = audit([VALID, '--output', 'blocker/out.json'], root);
    expect(result.status).toBe(2);
    expect(readdirSync(root)).toEqual(['blocker']);
  });

  test('defaults to ./dist', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-audit-cli-'));
    roots.push(root);
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/index.html'), '<!doctype html><html lang="en"><head><title>x</title></head><body></body></html>');
    const report = JSON.parse(audit(['--format', 'json'], root).stdout);
    expect(report.target.value).toBe('dist');
    expect(report.summary.pagesChecked).toBe(1);
  });

  test('a live audit records its crawl scope', async () => {
    const fetch = /** @type {typeof globalThis.fetch} */ (async () => new Response(
      '<!doctype html><html lang="en"><head><title>t</title><meta name="description" content="d"></head><body></body></html>',
      { headers: { 'content-type': 'text/html' } },
    ));
    const result = await runAudit(['https://example.com/', '--format', 'json', '--max-pages', 'unlimited', '--allow-origin', 'https://cdn.example.com'], { version: '1.4.0', fetch });
    const report = JSON.parse(result.output);
    expect(report.target).toEqual({ kind: 'url', value: 'https://example.com/' });
    expect(report.scope).toEqual({
      origins: ['https://cdn.example.com', 'https://example.com'],
      maxPages: 'unlimited',
      pagesFetched: 1,
      truncated: false,
      skippedExternal: 0,
    });
  });

  test('validate is unchanged by the audit command', () => {
    const result = spawnSync(process.execPath, [BIN, 'validate', BROKEN, '--json'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(Object.keys(JSON.parse(result.stdout))).toEqual(['ok', 'errors', 'warnings', 'pagesChecked', 'artifactsChecked', 'sitemapsChecked']);
  });
});

describe('single-observation audit exports',() => {
  test('exports URL SARIF, annotations and summary without repeating the crawl or publishing queries',async() => {
    const root=realpathSync(mkdtempSync(join(tmpdir(),'astro-aeo-action-'))); roots.push(root);
    const calls=[];
    const fetch=/** @type {typeof globalThis.fetch} */ (async(url) => {calls.push(String(url));return new Response('<html lang="en"><head><title>Title</title></head></html>',{headers:{'content-type':'text/html'}});});
    const result=await runAudit(['https://example.test/?secret=private','--format','sarif','--output','audit.sarif','--github-output','annotations.txt','--summary-output','summary.md'],{cwd:root,version:'1.6.0',fetch});
    expect(calls).toEqual(['https://example.test/']);expect(result.output).toBe('');
    const annotations=readFileSync(join(root,'annotations.txt'),'utf8');
    expect(annotations).toContain('(https://example.test/)');expect(annotations).not.toContain('file=');
    const summary=readFileSync(join(root,'summary.md'),'utf8');expect(summary).toContain('https://example.test/');expect(summary).not.toContain('private');
    expect(JSON.parse(readFileSync(join(root,'audit.sarif'),'utf8')).runs[0].results[0].locations).toBeUndefined();
  });
  test('writes URL exports into a real project reached through a linked folder',async() => {
    const root=realpathSync(mkdtempSync(join(tmpdir(),'astro-aeo-linked-output-')));roots.push(root);
    mkdirSync(join(root,'real','proj'),{recursive:true});symlinkSync(join(root,'real'),join(root,'link'));
    const fetch=/** @type {typeof globalThis.fetch} */ (async() => new Response('<html lang="en"><head><title>Title</title></head></html>',{headers:{'content-type':'text/html'}}));
    await runAudit(['https://example.test/','--format','sarif','--output','audit.sarif','--summary-output','summary.md'],{cwd:join(root,'link','proj'),version:'1.6.0',fetch});
    expect(JSON.parse(readFileSync(join(root,'real','proj','audit.sarif'),'utf8')).version).toBe('2.1.0');
    expect(readFileSync(join(root,'real','proj','summary.md'),'utf8')).toContain('https://example.test/');
  });
  test('refuses duplicate outputs and symlinked destinations',async() => {
    const root=realpathSync(mkdtempSync(join(tmpdir(),'astro-aeo-audit-output-')));roots.push(root);
    await expect(runAudit([VALID,'--output','same','--github-output','same'],{cwd:root,version:'1.6.0'})).rejects.toThrow('distinct');
    writeFileSync(join(root,'original'),'unchanged');symlinkSync(join(root,'original'),join(root,'link'));
    await expect(runAudit([VALID,'--output','link'],{cwd:root,version:'1.6.0'})).rejects.toThrow('safely');
    expect(readFileSync(join(root,'original'),'utf8')).toBe('unchanged');
  });
  test.each([
    [VALID,'--discovery'],
    ['https://example.test/','--discovery-base','/docs'],
    ['https://example.test/','--discovery','--discovery-base','/../private'],
    ['https://example.test/','--discovery','--discovery-base','/docs?secret'],
  ])('rejects unsupported discovery invocation %j',async(...args) => {
    await expect(runAudit(args,{version:'1.6.0',fetch:/** @type {typeof globalThis.fetch} */ (() => {throw new Error('Must not fetch');})})).rejects.toBeInstanceOf(AuditInvocationError);
  });
});

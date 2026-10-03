import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const bin = fileURLToPath(new URL('../../bin/astro-aeo.js',import.meta.url));
it('routes actual report stdin through the CLI and keeps JSON stdout clean', () => {
  const result = spawnSync(process.execPath,[bin,'report','traffic','-','--format','json'],{input:'',encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({version:1,type:'traffic',observed:0});
  expect(result.stderr).toContain('No matching observations');
});
it('returns exit 2 and sanitized errors for malformed CLI report input', () => {
  const result = spawnSync(process.execPath,[bin,'report','traffic','-'],{input:'secret is not JSON',encoding:'utf8'});
  expect(result.status).toBe(2); expect(result.stdout).toBe('');
  expect(result.stderr).toContain('line 1'); expect(result.stderr).not.toContain('secret');
});
it('documents the five report commands without changing validator flags', () => {
  const result = spawnSync(process.execPath,[bin,'--help'],{encoding:'utf8'});
  expect(result.status).toBe(0); expect(result.stdout).toContain('report traffic|changes|inspect|graph|rag');
  expect(result.stdout).toContain('Options for "validate"');
});

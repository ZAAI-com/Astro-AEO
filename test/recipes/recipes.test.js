import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { auditDist } from '../../src/audit/local.js';
import { ASTRO_BIN, REPO } from '../adapters/helpers.js';

const RECIPES = join(REPO, 'recipes');
const names = readdirSync(RECIPES).filter((name) => statSync(join(RECIPES, name)).isDirectory()).sort();
// An on-demand site has no HTML files to audit: its pages exist at request time.
const ON_DEMAND = new Set(['ssr']);
// EmDash recipes need a seeded database and a running server, so emdash.test.js
// builds and audits each of them once.
const isEmDash = (name) => name === 'emdash' || name.startsWith('emdash-');

describe('recipes', () => {
  test('cover the thirteen documented kinds of site, each with a README', () => {
    expect(names).toEqual([
      'blog',
      'commerce',
      'emdash',
      'emdash-blog',
      'emdash-marketing',
      'emdash-portfolio',
      'emdash-starter',
      'i18n',
      'local-business',
      'marketing',
      'saas',
      'ssr',
      'starlight',
    ]);
    const index = readFileSync(join(RECIPES, 'README.md'), 'utf8');
    for (const name of names) {
      expect(existsSync(join(RECIPES, name, 'README.md')), name).toBe(true);
      expect(index).toContain(`](${name}/)`);
    }
  });

  test.each(names.filter((name) => !isEmDash(name)))('%s builds and audits with no errors', (name) => {
    const root = join(RECIPES, name);
    const build = spawnSync(process.execPath, [ASTRO_BIN, 'build', '--root', root], { cwd: REPO, encoding: 'utf8' });
    expect(build.status, `${build.stdout}${build.stderr}`).toBe(0);
    // A server build puts its static files under dist/client.
    const dist = existsSync(join(root, 'dist', 'client')) ? join(root, 'dist', 'client') : join(root, 'dist');
    const { findings, pagesChecked } = auditDist(dist, { projectRoot: root });
    const errors = findings.filter((finding) => finding.severity === 'error' && !(ON_DEMAND.has(name) && finding.ruleId === 'no-html'));
    expect(errors.map((finding) => `${finding.ruleId} ${finding.url ?? finding.file ?? ''}: ${finding.message}`)).toEqual([]);
    if (!ON_DEMAND.has(name)) expect(pagesChecked).toBeGreaterThan(0);
  });
});

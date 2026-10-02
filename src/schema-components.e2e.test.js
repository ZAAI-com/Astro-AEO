import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySchemaComponents } from '../test/contracts/schema-components.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(REPO, 'fixtures/schema-tools/static');
const astroDir = join(REPO, 'node_modules/astro');
const astroPackage = JSON.parse(readFileSync(join(astroDir, 'package.json'), 'utf8'));
const astroBin = join(astroDir, typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro);

let html;
let output;
beforeAll(() => {
  const build = spawnSync(process.execPath, [astroBin, 'build', '--root', FIXTURE], { cwd: REPO, encoding: 'utf8' });
  output = build.stdout + build.stderr;
  expect(build.status, output).toBe(0);
  html = readFileSync(join(FIXTURE, 'dist/index.html'), 'utf8');
});
describe('schema component static rendering', () => {
  test('renders typed entities safely without mutating input', () => verifySchemaComponents(html));
  test('Google checks explain unsupported profiles without suppressing output', () => {
    expect(output).toContain('info: TechArticle: no Google profile is implemented by this checker');
    expect(output).toContain('info: FAQPage: no Google profile is implemented by this checker');
    expect(html).toContain('Technical');
    expect(html).toContain('FAQPage');
  });
});

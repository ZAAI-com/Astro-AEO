import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifySchemaComponents } from '../test/contracts/schema-components.js';

const astroPackage = JSON.parse(readFileSync('node_modules/astro/package.json', 'utf8'));
const astroBin = join('node_modules/astro', typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro);

let html;
let output;
beforeAll(() => {
  const build = spawnSync(process.execPath, [astroBin, 'build', '--root', 'fixtures/schema-tools/static'], { encoding: 'utf8' });
  output = build.stdout + build.stderr;
  expect(build.status, output).toBe(0);
  html = readFileSync('fixtures/schema-tools/static/dist/index.html', 'utf8');
});
describe('schema component static rendering', () => {
  test('renders typed entities safely without mutating input', () => verifySchemaComponents(html));
  test('Google checks explain unsupported profiles without suppressing output', () => {
    expect(output).toContain('info: TechArticle: no current documented Google profile');
    expect(output).toContain('info: FAQPage: no current documented Google profile');
    expect(html).toContain('Technical');
    expect(html).toContain('FAQPage');
  });
});

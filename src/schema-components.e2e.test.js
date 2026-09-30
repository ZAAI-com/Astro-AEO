import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { verifySchemaComponents } from '../test/contracts/schema-components.js';

let html;
let output;
beforeAll(() => {
  output = execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build', '--root', 'fixtures/schema-tools/static'], { encoding: 'utf8' });
  html = readFileSync('fixtures/schema-tools/static/dist/index.html', 'utf8');
});
describe('schema component static rendering', () => {
  test('renders typed entities safely without mutating input', () => verifySchemaComponents(html));
  test('Google checks explain unsupported profiles without suppressing output', () => {
    expect(output).toContain('build');
    expect(html).toContain('Technical');
    expect(html).toContain('FAQPage');
  });
});

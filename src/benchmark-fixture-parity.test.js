import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

describe('benchmark fixture parity', () => {
  for (const adapter of ['node', 'cloudflare']) {
    it(`mirrors the ${adapter} application surface without Astro-AEO`, () => {
      const withIntegration = join(root, 'fixtures/adapters', adapter);
      const baseline = join(root, 'fixtures/benchmarks', `${adapter}-baseline`);

      expect(filesBelow(join(baseline, 'src'))).toEqual(filesBelow(join(withIntegration, 'src')));
      for (const config of [
        readFileSync(join(withIntegration, 'astro.config.mjs'), 'utf8'),
        readFileSync(join(baseline, 'astro.config.mjs'), 'utf8'),
      ]) {
        expect(config).toContain("site: 'https://adapter.example.com'");
        expect(config).toContain("base: '/docs'");
        expect(config).toContain("output: 'server'");
      }
    });
  }
});

function filesBelow(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path, base) : [relative(base, path)];
    })
    .sort();
}

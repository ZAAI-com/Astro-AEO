import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `src/core/` is the half of the pipeline that has to run where there is no
// filesystem: bundled into a consumer's SSR output, and eventually on an edge
// runtime. A `node:` import there does not fail here, it fails at the consumer's
// build, which is why this is asserted rather than left to review.
const CORE = fileURLToPath(new URL('.', import.meta.url));

/** @returns {string[]} every .js file under `dir`, excluding tests. */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.js') && !entry.endsWith('.test.js') ? [full] : [];
  });
}

describe('src/core runtime safety', () => {
  const files = sourceFiles(CORE);

  test('the boundary covers a real set of modules, so an empty pass means nothing', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  test('no module imports a node: builtin', () => {
    const offenders = files
      .filter((file) => /(?:from|import)\s*\(?\s*['"]node:/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(CORE, file));
    expect(offenders).toEqual([]);
  });

  test('no module reaches into a directory that does read the filesystem', () => {
    // `src/lib/errors.js` is pure and allowed; the rest of src/lib, src/build,
    // src/sources, src/generators, and src/hooks are not.
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const [, specifier] of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = relative(CORE, join(file, '..', specifier));
        if (!resolved.startsWith('..')) continue;
        if (resolved.endsWith(join('lib', 'errors.js'))) continue;
        offenders.push(`${relative(CORE, file)} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `src/core/` and `src/runtime/` are the halves of the pipeline that have to run
// where there is no filesystem: bundled into a consumer's SSR output, and
// eventually on an edge runtime. A `node:` import there does not fail here, it
// fails at the consumer's build, which is why this is asserted rather than left
// to review.
const CORE = fileURLToPath(new URL('.', import.meta.url));
const RUNTIME = fileURLToPath(new URL('../runtime/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../schema.js', import.meta.url));

/** @returns {string[]} every .js file under `dir`, excluding tests. */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.js') && !entry.endsWith('.test.js') ? [full] : [];
  });
}

describe('src/core and src/runtime safety', () => {
  // The public schema entry is also bundled into edge/runtime consumers. It
  // lives at the package root to pair with its hand-written declaration.
  const files = [...sourceFiles(CORE), ...sourceFiles(RUNTIME), SCHEMA];

  test('the boundary covers a real set of modules, so an empty pass means nothing', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(sourceFiles(RUNTIME).length).toBeGreaterThan(0);
  });

  test('no module imports a node: builtin', () => {
    const offenders = files
      .filter((file) => /(?:from|import)\s*\(?\s*['"]node:/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(CORE, file));
    expect(offenders).toEqual([]);
  });

  test('no module reaches into a directory that does read the filesystem', () => {
    // `src/lib/errors.js` is pure and allowed, as is anything in core (which this
    // same suite checks). Everything else in src/lib, src/build, src/sources,
    // src/generators, and src/hooks reads the filesystem.
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const [, specifier] of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        if (!specifier.startsWith('.')) continue;
        const target = join(file, '..', specifier);
        // Both safe directories may import from each other and from themselves.
        if (!relative(CORE, target).startsWith('..')) continue;
        if (!relative(RUNTIME, target).startsWith('..')) continue;
        if (target === SCHEMA) continue;
        if (target.endsWith(join('lib', 'errors.js'))) continue;
        offenders.push(`${relative(CORE, file)} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

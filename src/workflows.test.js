// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const directory = '.github/workflows';
const workflows = readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, workflow: parse(readFileSync(join(directory, name), 'utf8')) }));

describe('GitHub workflows', () => {
  // The adapter runtime contract requires the exact .tool-versions Deno. A
  // floating install passes until the next release, then fails the tag gate.
  test('install Deno only from the .tool-versions pin', () => {
    const steps = workflows.flatMap(({ name, workflow }) =>
      Object.values(workflow.jobs ?? {}).flatMap((/** @type {any} */ job) =>
        (job.steps ?? []).filter((/** @type {any} */ step) => String(step.uses ?? '').startsWith('denoland/setup-deno@'))
          .map((/** @type {any} */ step) => ({ name, with: step.with ?? {} }))));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step, step.name).toMatchObject({ with: { 'deno-version-file': '.tool-versions' } });
      expect(step.with, step.name).not.toHaveProperty('deno-version');
    }
  });
});

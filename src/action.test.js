// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const action = parse(readFileSync('action.yml', 'utf8'));
const steps = action.runs.steps;

describe('action.yml', () => {
  test('is a composite action with the documented inputs and outputs', () => {
    expect(action.runs.using).toBe('composite');
    expect(Object.keys(action.inputs)).toEqual(['target', 'working-directory', 'fail-on', 'upload-sarif', 'sarif-file', 'args']);
    expect(Object.keys(action.outputs)).toEqual(['sarif-file', 'exit-code']);
  });

  test('never interpolates an input into a shell script', () => {
    for (const step of steps.filter((/** @type {any} */ candidate) => candidate.run)) {
      expect(step.run).not.toMatch(/\$\{\{/);
    }
  });

  test('runs the installed CLI, uploads, and reports the status last', () => {
    expect(steps[0].run).toContain('npx --no-install astro-aeo audit');
    expect(steps[0].run.trimEnd().endsWith('exit 0')).toBe(true);
    expect(steps[1].uses).toMatch(/^github\/codeql-action\/upload-sarif@/);
    expect(steps.at(-1).run).toContain('exit "$AEO_EXIT"');
  });
});

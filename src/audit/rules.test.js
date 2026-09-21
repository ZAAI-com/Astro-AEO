// @ts-check
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderRuleDocs } from '../../scripts/rule-docs.mjs';
import { AUDIT_CATEGORIES, categoryFor, getRule, helpUrlFor, listRules } from './rules.js';

const ROOT = resolve('.');
const CODE = "'((?:schema\\.)?[a-z][a-z0-9]*(?:-[a-z0-9]+)+)'";
// Codes reach a finding three ways: a `code:` property, the first argument of an
// emitter helper (after an optional `out`), or a ternary between two literals.
const EMITTERS = [
  new RegExp(`code:\\s*(?:[^,'\\n]*\\?\\s*[^:'\\n]*:\\s*)?${CODE}`, 'g'),
  new RegExp(`\\b(?:finding|error|warn|diagnostic|report)\\(\\s*(?:out,\\s*)?${CODE}`, 'g'),
  new RegExp(`\\?\\s*${CODE}\\s*:\\s*'(?:schema\\.)?[a-z0-9-]+'`, 'g'),
  new RegExp(`\\?\\s*'(?:schema\\.)?[a-z0-9-]+'\\s*:\\s*${CODE}`, 'g'),
];

// Ternaries between two literals that are not finding codes.
const NOT_CODES = new Set(['markdown-route', 'on-demand', 'read-only']);

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.js') && !name.endsWith('.test.js') ? [path] : [];
  });
}

const sources = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'cli'))]
  .filter((path) => !path.includes(join('src', 'audit')))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** @param {string[]} suffixes */
function emittedBy(suffixes) {
  const codes = new Set();
  for (const { path, text } of sources) {
    if (!suffixes.some((suffix) => path.endsWith(suffix))) continue;
    for (const pattern of EMITTERS) {
      for (const match of text.matchAll(pattern)) {
        if (!NOT_CODES.has(match[1])) codes.add(match[1]);
      }
    }
  }
  return codes;
}

describe('audit rule registry', () => {
  it.each([
    ['validator CLI', ['cli/validate.js', 'cli/validate-corpus.js'], 70],
    ['sitemap validator', ['src/build/sitemap-validate.js', 'src/core/sitemap-xml.js'], 25],
    ['schema graph validator', ['src/schema.js'], 12],
    ['build diagnostics', ['.js'], 170],
  ])('registers every code the %s emits', (_label, suffixes, floor) => {
    const emitted = emittedBy(suffixes);
    // A floor keeps a broken collector from passing on an empty set.
    expect(emitted.size).toBeGreaterThanOrEqual(floor);
    expect([...emitted].filter((code) => !getRule(code)).sort()).toEqual([]);
  });

  it('lists no rule that the source no longer mentions', () => {
    const all = sources.map((source) => source.text).join('\n');
    expect(listRules().map((rule) => rule.ruleId).filter((id) => !all.includes(`'${id}'`))).toEqual([]);
  });

  it('keeps entries unique, frozen and well formed', () => {
    const ids = listRules().map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of listRules()) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(AUDIT_CATEGORIES).toContain(rule.category);
      expect(['info', 'warning', 'error']).toContain(rule.severity);
      expect(rule.applicability.length).toBeGreaterThan(0);
      expect(rule.helpUrl).toBe(helpUrlFor(rule.ruleId));
    }
  });

  it('keeps dotted graph codes verbatim and anchors them the way GitHub does', () => {
    expect(getRule('schema.invalid-id')?.category).toBe('structured-data');
    expect(helpUrlFor('schema.invalid-id')).toMatch(/#schemainvalid-id$/);
  });

  it('files an unregistered code under build', () => {
    expect(getRule('third-party-plugin-code')).toBeUndefined();
    expect(categoryFor('third-party-plugin-code')).toBe('build');
  });

  it('keeps docs/rules.md current', () => {
    expect(readFileSync(join(ROOT, 'docs/rules.md'), 'utf8')).toBe(renderRuleDocs());
  });
});

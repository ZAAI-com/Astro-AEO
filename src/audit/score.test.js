// @ts-check
import { describe, expect, it } from 'vitest';
import { createFinding } from './finding.js';
import { scoreFindings } from './score.js';

/** @param {string} ruleId @param {'error'|'warning'|'info'} severity */
const make = (ruleId, severity) => createFinding({ ruleId, severity, message: ruleId });
/** @param {import('../index.js').AuditScores} scores @param {string} category */
const scoreOf = (scores, category) => scores.categories.find((entry) => entry.category === category)?.score;

describe('astro-aeo-readiness-v1', () => {
  it('scores a clean report at 100 and omits internationalization for one language', () => {
    const { scores } = scoreFindings([], { languageCount: 1 });
    expect(scores).toMatchObject({ rubric: 'astro-aeo-readiness-v1', overall: 100 });
    expect(scores.categories.map((entry) => entry.category)).not.toContain('internationalization');
    expect(scoreFindings([], { languageCount: 2 }).scores.categories.map((entry) => entry.category))
      .toContain('internationalization');
  });

  it('weighs error 15, warning 5 and info 0', () => {
    const { findings, scores } = scoreFindings([make('no-llms', 'error'), make('orphan-md', 'warning'), make('no-html', 'info')]);
    expect(findings.map((finding) => finding.deduction)).toEqual([15, 5, 0]);
    expect(scoreOf(scores, 'discovery')).toBe(85);
    expect(scoreOf(scores, 'markdown')).toBe(95);
  });

  it('caps one rule at 30 and lets errors consume the cap first', () => {
    const input = [
      make('orphan-md', 'warning'),
      make('orphan-md', 'warning'),
      make('orphan-md', 'error'),
      make('orphan-md', 'warning'),
      make('orphan-md', 'warning'),
    ];
    const { findings, scores } = scoreFindings(input);
    expect(findings.map((finding) => finding.deduction)).toEqual([5, 5, 15, 5, 0]);
    expect(scoreOf(scores, 'markdown')).toBe(70);
  });

  it('caps per rule, not per category, and floors a category at 0', () => {
    const rules = ['missing-md', 'orphan-md', 'no-alternate-link', 'duplicate-alternate-link'];
    const input = rules.flatMap((rule) => [make(rule, 'error'), make(rule, 'error'), make(rule, 'error')]);
    expect(scoreOf(scoreFindings(input).scores, 'markdown')).toBe(0);
  });

  it('rounds the overall mean to two decimals', () => {
    // Seven applicable categories, one at 85: (6 * 100 + 85) / 7 = 97.857...
    expect(scoreFindings([make('no-llms', 'error')]).scores.overall).toBe(97.86);
  });

  it('is independent of input order', () => {
    const input = [make('orphan-md', 'warning'), make('orphan-md', 'error'), make('no-llms', 'error')];
    expect(scoreFindings([...input].reverse()).scores).toEqual(scoreFindings(input).scores);
  });
});

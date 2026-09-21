// @ts-check
import { AUDIT_CATEGORIES } from './rules.js';

/**
 * Advisory readiness scoring. Scores describe a report and never gate it: exit
 * status is decided from severities alone.
 *
 * @typedef {import('../index.js').Finding} Finding
 * @typedef {import('../index.js').AuditScores} AuditScores
 */

export const SCORE_RUBRIC = 'astro-aeo-readiness-v1';

const WEIGHTS = Object.freeze({ error: 15, warning: 5, info: 0 });
const RULE_CAP = 30;
const SEVERITY_RANK = Object.freeze({ error: 0, warning: 1, info: 2 });

/**
 * Assign a deduction to every finding and score each applicable category.
 * Within one `(category, ruleId)` pair errors consume the cap first, and a
 * finding past the cap records `deduction: 0`. Findings of equal severity weigh
 * the same, so input order cannot change a score.
 *
 * @param {readonly Finding[]} findings
 * @param {{ languageCount?: number }} [options]
 * @returns {{ findings: Finding[]; scores: AuditScores }}
 */
export function scoreFindings(findings, options = {}) {
  const multilingual = (options.languageCount ?? 0) > 1;
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  findings.forEach((finding, index) => {
    const key = JSON.stringify([finding.category, finding.ruleId]);
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });

  /** @type {number[]} */
  const deductions = new Array(findings.length).fill(0);
  for (const indexes of groups.values()) {
    let remaining = RULE_CAP;
    const ordered = [...indexes].sort((left, right) =>
      SEVERITY_RANK[findings[left].severity] - SEVERITY_RANK[findings[right].severity] || left - right);
    for (const index of ordered) {
      const deduction = Math.min(WEIGHTS[findings[index].severity], remaining);
      deductions[index] = deduction;
      remaining -= deduction;
    }
  }

  const scored = findings.map((finding, index) => ({ ...finding, deduction: deductions[index] }));
  const categories = AUDIT_CATEGORIES
    .filter((category) => category !== 'internationalization' || multilingual)
    .map((category) => {
      const own = scored.filter((finding) => finding.category === category);
      const deducted = own.reduce((total, finding) => total + finding.deduction, 0);
      return { category, score: Math.max(0, 100 - deducted), findings: own.length };
    });
  const mean = categories.reduce((total, entry) => total + entry.score, 0) / categories.length;
  return {
    findings: scored,
    scores: { rubric: SCORE_RUBRIC, overall: Math.round(mean * 100) / 100, categories },
  };
}

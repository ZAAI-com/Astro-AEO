import { AUDIT_CATEGORIES, listRules } from '../src/audit/rules.js';

/** Render `docs/rules.md`, the page every finding's `helpUrl` points into. */
export function renderRuleDocs() {
  const lines = [
    '# Astro-AEO rules',
    '',
    'Generated from `src/audit/rules.js` by `node scripts/generate-rule-docs.mjs`. Do not edit by hand.',
    '',
    'A rule ID is the `code` of a build diagnostic or validator finding, and the `ruleId` of an audit',
    'finding. The severity shown is the usual one: a few rules are configurable, and a finding always',
    'reports the severity it was actually raised with.',
    '',
  ];
  for (const category of AUDIT_CATEGORIES) {
    const rules = listRules()
      .filter((rule) => rule.category === category)
      .sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1));
    if (rules.length === 0) continue;
    lines.push(`## Category: ${category}`, '');
    for (const rule of rules) {
      lines.push(`### ${rule.ruleId}`, '', `Severity: ${rule.severity}. Raised by: ${rule.applicability.join(', ')}.`, '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

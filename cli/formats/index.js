// @ts-check
import { serializeAuditReport } from '../../src/audit/report.js';
import { renderGithub } from './github.js';
import { renderHtml } from './html.js';
import { renderJunit } from './junit.js';
import { renderMarkdown } from './markdown.js';
import { renderSarif } from './sarif.js';
import { renderTerminal } from './terminal.js';

/** @typedef {import('../../src/index.js').AuditReportV1} AuditReportV1 */

/** Every format renders the same report; none of them recomputes anything. */
export const AUDIT_FORMATS = Object.freeze({
  terminal: renderTerminal,
  json: serializeAuditReport,
  sarif: renderSarif,
  html: renderHtml,
  markdown: renderMarkdown,
  github: renderGithub,
  junit: renderJunit,
});

/** @param {string} format @returns {format is keyof typeof AUDIT_FORMATS} */
export function isAuditFormat(format) {
  return Object.hasOwn(AUDIT_FORMATS, format);
}

/** @param {AuditReportV1} report @param {keyof typeof AUDIT_FORMATS} format */
export function renderAuditReport(report, format) {
  return AUDIT_FORMATS[format](report);
}

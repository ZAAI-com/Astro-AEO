// @ts-check
import { createHash } from 'node:crypto';
import { escapeXml } from './shared.js';
/** Exact inline bytes only. No unsafe-inline, remote assets, navigation base or network connections.
 * @param {string} style @param {string[]} [scripts] */
export function cspMeta(style, scripts = []) {
  const digest = (/** @type {string} */ text) => "'sha256-" + createHash('sha256').update(text).digest('base64') + "'";
  const policy = "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'none'; img-src 'none'; "
    + "style-src " + digest(style) + "; script-src " + (scripts.length ? scripts.map(digest).join(' ') : "'none'");
  return '<meta http-equiv="Content-Security-Policy" content="' + escapeXml(policy) + '">';
}

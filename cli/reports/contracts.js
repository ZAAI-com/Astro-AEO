// @ts-check
import { readFileSync } from 'node:fs';
import { ReportInvocationError } from './io.js';
import { inspectRootPathname } from '../../src/core/match.js';
import { evidenceHash } from '../../src/build/evidence.js';
/** @type {Map<string, any>} */
const schemas = new Map();
/** Packaged contracts only; no consumer modules or remotely resolved references.
 * @param {unknown} value @param {string} name */
export function assertContract(value, name) {
  let schema = schemas.get(name);
  if (!schema) {
    schema = JSON.parse(readFileSync(new URL('../../schema/' + name + '.schema.json', import.meta.url), 'utf8'));
    schemas.set(name, schema);
  }
  const valid = matches(value,schema);
  if (valid) {
    /** @param {any} entry @param {number} [depth] @returns {boolean} */
    const pathsSafe = (entry, depth = 0) => {
      if (depth > 32) return false;
      if (!entry || typeof entry !== 'object') return true;
      return Object.entries(entry).every(([key, child]) =>
        key === 'pathname' ? typeof child === 'string' && inspectRootPathname(child) !== null : pathsSafe(child,depth+1));
    };
    if (!pathsSafe(value)) throw new ReportInvocationError('Report input contains an unsafe public path.');
  }
  if (!valid) throw new ReportInvocationError('Report input does not match ' + name + '.');
}
/** Validator for the keywords in our shipped data contracts, never arbitrary third-party schemas.
 * @param {any} value @param {any} schema @param {number} [depth] */
export function matches(value, schema, depth = 0) {
  if (depth > 32) return false;
  if (schema.anyOf && !schema.anyOf.some((/** @type {any} */ s) => matches(value,s,depth+1))) return false;
  if (schema.allOf && !schema.allOf.every((/** @type {any} */ s) => matches(value,s,depth+1))) return false;
  if (schema.if && !matches(value, matches(value,schema.if,depth+1) ? schema.then ?? {} : schema.else ?? {},depth+1)) return false;
  if (Object.hasOwn(schema,'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((/** @type {string} */ t) => t === 'null' ? value === null :
      t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) :
      t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === t);
    if (!valid) return false;
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value) || schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.format === 'date-time' && (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) return false;
  }
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum ||
    schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((v) => matches(v,schema.items,depth+1))) return false;
  } else if (value !== null && typeof value === 'object') {
    if (schema.required?.some((/** @type {string} */ k) => !Object.hasOwn(value,k))) return false;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__','prototype','constructor'].includes(key)) return false;
      if (schema.propertyNames && !matches(key,schema.propertyNames,depth+1)) return false;
      const definition = Object.hasOwn(schema.properties ?? {},key) ? schema.properties[key] : schema.additionalProperties;
      if (definition === false || typeof definition === 'object' && !matches(child,definition,depth+1)) return false;
    }
  }
  return true;
}
/** @param {any} value */
export function assertSnapshot(value) {
  assertContract(value,'page-snapshot-v1');
  const seen = new Set();
  for (const page of value.pages) {
    const key = JSON.stringify([page.pathname,page.locale,page.version]);
    if (seen.has(key) || !inspectRootPathname(page.pathname) || page.routePattern && !inspectRootPathname(page.routePattern)) throw new ReportInvocationError('Snapshot has unsafe or duplicate page identities.');
    seen.add(key);
  }
  const artifacts = new Set();
  for (const entry of value.artifacts) {
    if (artifacts.has(entry.pathname) || !inspectRootPathname(entry.pathname)) throw new ReportInvocationError('Snapshot has unsafe or duplicate artifact paths.');
    artifacts.add(entry.pathname);
  }
  const { buildDigest, ...identity } = value;
  return evidenceHash(identity) === buildDigest;
}

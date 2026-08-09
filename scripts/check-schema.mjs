#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSchema, serializeSchema } from './schema-definition.mjs';
import { resolveConfig } from '../src/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'schema/astro-aeo.schema.json');
const committed = await readFile(destination, 'utf8').catch(() => '');
const expected = serializeSchema();

if (committed !== expected) {
  console.error('schema/astro-aeo.schema.json is stale. Run: node scripts/generate-schema.mjs');
  process.exitCode = 1;
} else {
  const sourceSchema = buildSchema();
  const publishedSchema = JSON.parse(committed);
  const resolved = resolveConfig();
  const errors = [];
  assertResolvedSurface(resolved, publishedSchema, '', errors);
  assertDefaults(resolved, sourceSchema, '', errors);
  if (errors.length > 0) {
    for (const error of errors) console.error(`configuration schema: ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Configuration schema is current and covers the resolved configuration surface.');
  }
}

function assertResolvedSurface(value, schema, path, errors) {
  if (!isPlainObject(value) || !isPlainObject(schema?.properties)) return;
  for (const [key, child] of Object.entries(value)) {
    const dotted = path ? `${path}.${key}` : key;
    // Resolved-only policy derived from discovery.robots.includeSitemap.
    if (dotted === 'discovery.robots.sitemapPolicy') continue;
    const childSchema = schema.properties[key];
    if (!childSchema) {
      errors.push(`resolved option ${dotted} is missing`);
      continue;
    }
    assertResolvedSurface(child, childSchema, dotted, errors);
  }
}

function assertDefaults(resolved, schema, path, errors) {
  if (!isPlainObject(schema)) return;
  if (Object.prototype.hasOwnProperty.call(schema, 'default') && path) {
    const actual = getPath(resolved, path);
    if (JSON.stringify(actual) !== JSON.stringify(schema.default)) {
      errors.push(
        `${path} default is ${JSON.stringify(schema.default)} in the schema but resolves to ${JSON.stringify(actual)}`,
      );
    }
  }
  if (!isPlainObject(schema.properties)) return;
  for (const [key, childSchema] of Object.entries(schema.properties)) {
    if (!(key in resolved) && path === '') continue; // Skip deprecated top-level aliases.
    const dotted = path ? `${path}.${key}` : key;
    assertDefaults(resolved, childSchema, dotted, errors);
  }
}

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serializeSchema } from './schema-definition.mjs';
import { serializeAuditReportSchema } from './audit-report-schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'schema/astro-aeo.schema.json');

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, serializeSchema(), 'utf8');
console.log(`Wrote ${destination}`);

const auditDestination = resolve(root, 'schema/audit-report-v1.schema.json');
await writeFile(auditDestination, serializeAuditReportSchema(), 'utf8');
console.log(`Wrote ${auditDestination}`);

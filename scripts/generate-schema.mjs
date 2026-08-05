#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serializeSchema } from './schema-definition.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'schema/astro-aeo.schema.json');

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, serializeSchema(), 'utf8');
console.log(`Wrote ${destination}`);

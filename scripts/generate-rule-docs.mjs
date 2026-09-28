#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderRuleDocs } from './rule-docs.mjs';

const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/rules.md');
await writeFile(destination, renderRuleDocs(), 'utf8');
console.log(`Wrote ${destination}`);

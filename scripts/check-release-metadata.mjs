#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import { releaseEvidenceErrors } from './release-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const explicitTag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
const requireTag = args.includes('--require-tag');
const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
const tag = explicitTag ?? environmentTag;

const errors = [];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  errors.push(`package.json version is not a publishable SemVer: ${JSON.stringify(pkg.version)}`);
}
if (!new RegExp(`^## ${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md has no exact "## ${pkg.version}" heading`);
}
if (requireTag && !tag) errors.push('release metadata check requires a numeric version tag');
if (tag && tag !== pkg.version) {
  errors.push(`release tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(pkg.version)}`);
}

const changesetDir = resolve(root, '.changeset');
const pending = (await readdir(changesetDir, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
  .map((entry) => basename(entry.name));
if (requireTag && pending.length > 0) {
  errors.push(`unconsumed changesets remain: ${pending.join(', ')}`);
}
if (requireTag) {
  const evidencePath = resolve(
    root,
    'docs',
    'release-evidence',
    `${pkg.version}-semantic-validation.md`,
  );
  try {
    const evidence = await readFile(evidencePath, 'utf8');
    errors.push(...releaseEvidenceErrors(evidence, pkg.version));
  } catch {
    errors.push(`semantic validation evidence is missing for ${pkg.version}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`release metadata: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Release metadata agrees on ${pkg.version}${tag ? ` (tag ${tag})` : ''}.`);
}

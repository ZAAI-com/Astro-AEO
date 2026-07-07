#!/usr/bin/env bash
# Install dependencies from the committed pnpm lockfile (matches CI S1-Test.yml).
set -euo pipefail

pnpm install --frozen-lockfile

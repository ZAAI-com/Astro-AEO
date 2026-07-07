#!/usr/bin/env bash
# Vitest in watch mode: colocated unit + CLI tests.
set -euo pipefail

exec pnpm run test:watch

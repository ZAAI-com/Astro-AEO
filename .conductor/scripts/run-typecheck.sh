#!/usr/bin/env bash
# One-shot type check (tsc --noEmit against the JSDoc types).
set -euo pipefail

exec pnpm run typecheck

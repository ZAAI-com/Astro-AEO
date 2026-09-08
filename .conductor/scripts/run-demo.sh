#!/usr/bin/env bash
# Live-preview the demo Astro site on this workspace's assigned Conductor port.
# Calls the Astro CLI directly with an absolute root: pnpm 11 forwards "--" verbatim
# (astro dev rejects it as an unknown subcommand), and Astro re-resolves a relative
# --root inside its own child process, which lands on fixtures/demo/fixtures/demo.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

exec pnpm exec astro dev \
  --root "$repo_root/fixtures/demo" \
  --port "${CONDUCTOR_PORT:?CONDUCTOR_PORT is not set}"

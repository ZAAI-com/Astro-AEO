#!/usr/bin/env bash
# Live-preview the demo Astro site on this workspace's assigned Conductor port.
set -euo pipefail

exec pnpm run demo:dev -- --port "${CONDUCTOR_PORT:?CONDUCTOR_PORT is not set}"

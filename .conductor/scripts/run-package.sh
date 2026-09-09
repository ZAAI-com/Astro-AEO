#!/usr/bin/env bash
# Pack the tarball, install it into a throwaway Astro consumer, and build it.
set -euo pipefail

exec pnpm run package:smoke

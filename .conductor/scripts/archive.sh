#!/usr/bin/env bash
# Light cleanup of gitignored build/test artifacts before the workspace is archived.
set -euo pipefail

rm -rf fixtures/demo/dist fixtures/demo/.astro coverage

#!/usr/bin/env sh
set -eu

# Configure SUPERPOWERS_HARNESS_WORKSPACE to the project root.
workspace="${SUPERPOWERS_HARNESS_WORKSPACE:-$PWD}"
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
node "$root/bin/superpowers-harness.mjs" ingest codex --workspace "$workspace" -

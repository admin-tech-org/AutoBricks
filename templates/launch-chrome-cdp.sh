#!/usr/bin/env bash
# Copy this script and launch-chrome-cdp.mjs into the project's .browser/.
# Node 22+ reads cdp.env beside the scripts; optional first argument overrides the port.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/launch-chrome-cdp.mjs" "$@"

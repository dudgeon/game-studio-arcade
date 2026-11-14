#!/bin/bash
# The Picade's Anthropic identity, set up once before the flash (D329). Run it yourself, in a Terminal window on
# the mini, from the repo on main, after making the cabinet-picade workspace and its key in the Console:
#
#   scripts/cabinet-card/picade-key.sh           paste the key when asked (nothing shows); it checks, applies, stores, proves
#   scripts/cabinet-card/picade-key.sh --check   proves the stored identity again; asks for nothing
#
# It prints only ok or fail, the workspace and the agent version: never the key. See picade-key.mjs.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="${GSA_NODE:-/opt/homebrew/opt/node@22/bin/node}"
[ -x "$NODE" ] || { echo "Stopped: Node 22 is missing at $NODE" >&2; exit 1; }
exec "$NODE" "$REPO/scripts/cabinet-card/picade-key.mjs" "$@"

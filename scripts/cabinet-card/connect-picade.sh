#!/bin/bash
# Connects the Picade to its own workspace (D131, D155, D254): connect-cabinet.sh, pointed at the real cabinet.
# Run it yourself, in a Terminal window on the mini, after the card's first boot reaches the shelf:
#
#   scripts/cabinet-card/connect-picade.sh             asks for the Picade's key, with no echo
#   scripts/cabinet-card/connect-picade.sh --reapply   after the Studio agent changes
#
# It reaches the cabinet as arcade.local with the key flash.mjs made for it, applies the Studio agent with
# its own lock file (claude-lock.arcade.json), and refuses the mini's workspace and the virtual cabinet's.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CABINET_DIR="${GSA_CABINET_DIR:-$HOME/game-studio-data/cabinets/arcade}"
export CABINET=arcade
export ARCADE_HOST="${ARCADE_HOST:-arcade.local}"
export ARCADE_SSH_DIR="$CABINET_DIR/ssh"
export ARCADE_SSH_KEY_NAME=arcade_ed25519
[ -f "$ARCADE_SSH_DIR/$ARCADE_SSH_KEY_NAME" ] || { echo "Stopped: no SSH key for the Picade at $ARCADE_SSH_DIR. It's made when the card is written (scripts/cabinet-card/flash.mjs)." >&2; exit 1; }
# connect-cabinet.sh would otherwise take the virtual cabinet's address from its host file.
export GSA_VM_DIR="$CABINET_DIR"
exec "$REPO/scripts/virtual-cabinet/connect-cabinet.sh" "$@"

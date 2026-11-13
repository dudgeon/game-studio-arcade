#!/bin/bash
# groq-key.sh for the Picade (D263): the same Groq key on the real cabinet, over its own SSH key (D259).
# Run it yourself, in a Terminal window on the mini, once the Picade is connected (connect-picade.sh):
#
#   scripts/cabinet-card/groq-picade.sh          asks about Zero Data Retention, then for the key, with no echo
#   scripts/cabinet-card/groq-picade.sh --off    takes the key off the Picade; Moonshine carries on
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=picade-ssh.sh
. "$REPO/scripts/cabinet-card/picade-ssh.sh"
export ARCADE_HOST="${ARCADE_HOST:-$PICADE_HOST}"
export ARCADE_SSH_DIR="$PICADE_DIR/ssh"
export ARCADE_SSH_KEY_NAME="$PICADE_KEY_NAME"
[ -f "$ARCADE_SSH_DIR/$ARCADE_SSH_KEY_NAME" ] || { echo "Stopped: no SSH key for the Picade at $ARCADE_SSH_DIR. It's made when the card is written (scripts/cabinet-card/flash.mjs)." >&2; exit 1; }
# groq-key.sh would otherwise take the virtual cabinet's address from its host file.
export GSA_VM_DIR="$PICADE_DIR"
exec "$REPO/scripts/virtual-cabinet/groq-key.sh" "$@"

#!/bin/bash
# Stops and removes the Cabinet Manager's launchd agent (D368). The Manager key, the pairing tokens and the log stay.
# Afterwards scripts/manager.sh start runs it by hand, as before.
#
#   scripts/manager-launchd/uninstall.sh
set -euo pipefail
LABEL=com.game-studio-arcade.manager
AGENTS="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "Stopped $LABEL." || echo "$LABEL wasn't running."
if [ -f "$PLIST" ]; then
  rm "$PLIST"
  echo "Removed $PLIST."
fi
echo "Kept: the Manager key, the pairing tokens (~/.config/game-studio-arcade) and the log (~/game-studio-data/manager)."

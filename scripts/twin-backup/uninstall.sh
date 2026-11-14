#!/bin/bash
# Stops and removes the hourly backup's launchd agent (D350). The backup folder, its record and logs stay (D5).
#
#   scripts/twin-backup/uninstall.sh
set -euo pipefail
LABEL=com.game-studio-arcade.twin-backup
AGENTS="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "Stopped $LABEL." || echo "$LABEL wasn't running."
if [ -f "$PLIST" ]; then
  rm "$PLIST"
  echo "Removed $PLIST."
fi
echo "Kept: ${GSA_TWIN_DIR:-$HOME/game-studio-data/twin} (the backup folder, backup.json, the logs)."

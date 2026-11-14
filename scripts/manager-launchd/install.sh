#!/bin/bash
# Keeps the Cabinet Manager always on (D368): a launchd agent that starts it at login, with no window, and starts
# it again if it stops. Undo with uninstall.sh.
#
#   scripts/manager-launchd/install.sh            install it and start it now
#   scripts/manager-launchd/install.sh --print    print the agent's plist and do nothing else
#
# It runs manager/server.mjs from THIS checkout with Node 22. Run it from the main checkout, not a worktree that
# may be removed. A Manager that scripts/manager.sh started is stopped first, so only one holds the port.
# Its output goes to ~/game-studio-data/manager/manager.log, as with manager.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.game-studio-arcade.manager
AGENTS="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS/$LABEL.plist"
NODE="${MANAGER_NODE:-/opt/homebrew/opt/node@22/bin/node}"
DIR="${GSA_MANAGER_DIR:-$HOME/game-studio-data/manager}"
PORT="${MANAGER_PORT:-8335}"
stop() { echo "Stopped: $*" >&2; exit 1; }

case "$REPO" in */.claude/worktrees/*) [ "${1:-}" = --print ] || stop "this is a worktree ($REPO), which can be removed. Run install.sh from the main checkout." ;; esac
[ -x "$NODE" ] || stop "Node 22 is missing at $NODE"

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }
plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$REPO/manager/server.mjs")</string>
    <string>--port</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$DIR/manager.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$DIR/manager.log")</string>
</dict>
</plist>
EOF
}

if [ "${1:-}" = --print ]; then plist; exit 0; fi
[ -z "${ANTHROPIC_API_KEY+x}" ] || stop "ANTHROPIC_API_KEY is set in this shell. It must never be set on the mini (D16)."

mkdir -p "$AGENTS" "$DIR"
# One Manager on the port: stop one that manager.sh started.
if [ -f "$DIR/manager.pid" ] && kill -0 "$(cat "$DIR/manager.pid")" 2>/dev/null; then
  kill "$(cat "$DIR/manager.pid")" && rm -f "$DIR/manager.pid"
  echo "Stopped the Manager that scripts/manager.sh had started."
fi
plist > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null || stop "the plist didn't check out"
mv "$PLIST.tmp" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: the Manager starts at login and stays on, on port $PORT, from $REPO."
echo "See it with: scripts/manager.sh status. The first time in each browser: scripts/manager.sh url"

#!/bin/bash
# Installs the hourly backup of the Picade on the Mac mini (D350): a launchd agent, no window, no focus.
#
#   scripts/twin-backup/install.sh            install it and start it (runs once now, then every hour)
#   scripts/twin-backup/install.sh --print    print the agent's plist and do nothing else
#
# It runs scripts/twin-backup/run.mjs from THIS checkout with Node 22, as a background process at low priority.
# Run it from the main checkout, not a worktree that may be removed. Undo with uninstall.sh.
# Its output goes to ~/game-studio-data/twin/launchd.log; its record to ~/game-studio-data/twin/backup.json.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.game-studio-arcade.twin-backup
AGENTS="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS/$LABEL.plist"
NODE="${TWIN_BACKUP_NODE:-/opt/homebrew/opt/node@22/bin/node}"
HOME_DIR="${GSA_TWIN_DIR:-$HOME/game-studio-data/twin}"
INTERVAL="${TWIN_BACKUP_INTERVAL_S:-3600}"
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
    <string>$(xml "$REPO/scripts/twin-backup/run.mjs")</string>
    <string>--quiet</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$HOME_DIR/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$HOME_DIR/launchd.log")</string>
</dict>
</plist>
EOF
}

if [ "${1:-}" = --print ]; then plist; exit 0; fi
[ -z "${ANTHROPIC_API_KEY+x}" ] || stop "ANTHROPIC_API_KEY is set in this shell. It must never be set on the mini (D16)."

mkdir -p "$AGENTS" "$HOME_DIR"
plist > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null || stop "the plist didn't check out"
mv "$PLIST.tmp" "$PLIST"
# Replace a running copy, if there is one, then start it. RunAtLoad runs it once now.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: every $((INTERVAL / 60)) minutes, from $REPO."
echo "See it with: launchctl print gui/$(id -u)/$LABEL | head; and: cat $HOME_DIR/backup.json"

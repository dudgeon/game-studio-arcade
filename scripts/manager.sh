#!/bin/bash
# The Cabinet Manager on the mini (D280): one command, in the background, no window.
#
#   scripts/manager.sh start     start it (port 8335; MANAGER_PORT changes it)
#   scripts/manager.sh stop
#   scripts/manager.sh restart
#   scripts/manager.sh status    running or not, and its addresses
#   scripts/manager.sh url       the link that opens it in a browser, with the Manager key (D285). Once per browser.
#
# Its log: ~/game-studio-data/manager/manager.log. It keeps nothing else on the mini (D283).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/game-studio-data/manager"
PIDF="$DIR/manager.pid"
LOG="$DIR/manager.log"
PORT="${MANAGER_PORT:-8335}"
KEYF="$HOME/.config/game-studio-arcade/manager-web-key"
NODE="$(command -v node || true)"
[ -x /opt/homebrew/opt/node@22/bin/node ] && NODE=/opt/homebrew/opt/node@22/bin/node
mkdir -p "$DIR"

running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

addrs() {
  local a
  for ifc in en0 en1; do
    a="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
    [ -n "$a" ] && echo "$a"
  done
  echo "$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
}

case "${1:-}" in
  start)
    if running; then echo "The Manager is already running (pid $(cat "$PIDF"))."; exit 0; fi
    nohup "$NODE" "$REPO/manager/server.mjs" --port "$PORT" >> "$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDF"
    for _ in $(seq 1 20); do
      curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
      sleep 0.25
    done
    running || { echo "It didn't start; see $LOG" >&2; tail -5 "$LOG" >&2; exit 1; }
    echo "The Manager is running (pid $(cat "$PIDF")), port $PORT."
    echo "First time in a browser? Run: scripts/manager.sh url"
    ;;
  stop)
    if running; then kill "$(cat "$PIDF")"; rm -f "$PIDF"; echo "Stopped."; else echo "Not running."; fi
    ;;
  restart) "$0" stop; "$0" start ;;
  status)
    if running; then
      echo "Running (pid $(cat "$PIDF")) on port $PORT:"
      addrs | sed "s|^|  http://|; s|$|:$PORT/|"
    else
      echo "Not running. Start it with: scripts/manager.sh start"
    fi
    ;;
  url)
    [ -f "$KEYF" ] || { echo "No Manager key yet: start the Manager once first." >&2; exit 1; }
    echo "Open one of these once in each browser (it remembers you after that). The link holds the key: don't share it."
    addrs | while read -r a; do echo "  http://$a:$PORT/?key=$(tr -d '\n' < "$KEYF")"; done
    ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac

#!/bin/bash
# The Picade's driver keyboard (D287): lets the Cabinet Manager press the cabinet's buttons from the mini.
# Off unless switched on here. Uses the Picade's own admin SSH key (D254), which only the mini has.
#
#   scripts/cabinet-card/driver-keyboard.sh on      switch it on; stays on through updates and restarts
#   scripts/cabinet-card/driver-keyboard.sh off     switch it off
#   scripts/cabinet-card/driver-keyboard.sh status
#
# ARCADE_HOST picks the cabinet (default arcade.local).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=picade-ssh.sh
. "$REPO/scripts/cabinet-card/picade-ssh.sh"
CABINET_DIR="$PICADE_DIR"
export ARCADE_HOST="${ARCADE_HOST:-$PICADE_HOST}"
export ARCADE_SSH_DIR="$CABINET_DIR/ssh"
export ARCADE_SSH_KEY_NAME="$PICADE_KEY_NAME"
export GSA_VM_DIR="$CABINET_DIR"
[ -f "$ARCADE_SSH_DIR/$ARCADE_SSH_KEY_NAME" ] || { echo "Stopped: no SSH key for the Picade at $ARCADE_SSH_DIR (scripts/cabinet-card/flash.mjs makes it)." >&2; exit 1; }
on_cabinet() { ARCADE_SSH_TIMEOUT_S=60 "$REPO/cabinet/vm/drive" ssh "$1"; }

case "${1:-}" in
  on)
    on_cabinet 'grep -qx "profile=picade" /etc/arcade/cabinet.conf || { echo "not a picade cabinet" >&2; exit 1; }
      [ -x /usr/local/bin/arcade-keyd ] || { echo "this cabinet has no arcade-keyd yet: update its software first" >&2; exit 1; }
      echo on | sudo tee /etc/arcade/driver-keyboard >/dev/null
      echo uinput | sudo tee /etc/modules-load.d/arcade-driver.conf >/dev/null
      sudo modprobe uinput && sudo systemctl enable --now arcade-keyd && systemctl is-active arcade-keyd'
    echo "The Picade's driver keyboard is on: the Manager can press its buttons. Switch it off with: $0 off"
    ;;
  off)
    on_cabinet 'echo off | sudo tee /etc/arcade/driver-keyboard >/dev/null
      sudo rm -f /etc/modules-load.d/arcade-driver.conf
      sudo systemctl disable --now arcade-keyd 2>/dev/null || true'
    echo "The Picade's driver keyboard is off."
    ;;
  status)
    on_cabinet 'echo "setting: $(cat /etc/arcade/driver-keyboard 2>/dev/null || echo off)"; echo "service: $(systemctl is-active arcade-keyd 2>/dev/null || true)"'
    ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac

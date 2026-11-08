#!/bin/bash
# Reads the VM's serial console without a window: the way to see a boot that never reaches SSH.
#
#   scripts/virtual-cabinet/serial.sh LOGFILE [SECONDS]
#
# Appends to LOGFILE until SECONDS pass (default: until the VM stops). Echo is
# turned off first, or the console's own output would be typed back into the guest.
set -euo pipefail
LOG="${1:?usage: serial.sh LOGFILE [SECONDS]}"
SECONDS_WANTED="${2:-0}"
PTY="$(lsof -c UTM 2>/dev/null | grep -oE '/dev/ttys[0-9]+' | tail -1 || true)"
[ -n "$PTY" ] || { echo "no serial device: is the VM running?" >&2; exit 1; }
echo "serial device $PTY" >&2
stty -f "$PTY" raw -echo
cat "$PTY" >> "$LOG" &
reader=$!
if [ "$SECONDS_WANTED" -gt 0 ]; then
  sleep "$SECONDS_WANTED"
  kill "$reader" 2>/dev/null || true
else
  wait "$reader"
fi

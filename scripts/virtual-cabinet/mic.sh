#!/bin/bash
# The virtual cabinet's microphone (D127; lifts D141's AudioInput=false). UTM's Apple backend has no USB
# passthrough, so the cabinet hears the mini's default input through its virtio sound card. Make the USB mic the
# mini's default input first (System Settings > Sound > Input).
#
#   scripts/virtual-cabinet/mic.sh --check   says "on" or "off"
#   scripts/virtual-cabinet/mic.sh on        Geoff at the mini: macOS asks once whether UTM may use the microphone
#   scripts/virtual-cabinet/mic.sh off
#
# on/off: refuses while a make runs; stops the VM cleanly; quits UTM, which caches a VM's config (D148); keeps a
# copy of the config; sets AudioInput; starts the VM hidden (up.sh); then runs verify.sh, boot check included
# (D244), and lists the cabinet's capture devices. The disk, key and carts are untouched: not a rebuild.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
CONFIG="$VM_ROOT/arcade-virtual.utm/config.plist"
UTMCTL="${GSA_UTMCTL:-/Applications/UTM.app/Contents/MacOS/utmctl}"
PGREP="${GSA_PGREP:-pgrep}"
OSASCRIPT="${GSA_OSASCRIPT:-osascript}"
UP="${GSA_UP:-$REPO/scripts/virtual-cabinet/up.sh}"
VERIFY="${GSA_VERIFY:-$REPO/scripts/virtual-cabinet/verify.sh}"
DRIVE="${GSA_DRIVE:-$REPO/cabinet/vm/drive}"
OUT="${GSA_VERIFY_OUT:-$VM_ROOT/verify/mic-$(date -u +%Y%m%dT%H%M%SZ)}"

[ -f "$CONFIG" ] || { echo "no VM config at $CONFIG" >&2; exit 1; }
current() { [ "$(plutil -extract Virtualization.AudioInput raw -o - "$CONFIG" 2>/dev/null)" = true ] && echo on || echo off; }

case "${1:-}" in
  --check) current; exit 0 ;;
  on) want=true ;;
  off) want=false ;;
  *) echo "usage: mic.sh --check | on | off" >&2; exit 2 ;;
esac
if [ "$(current)" = "$1" ]; then echo "the microphone is already $1"; exit 0; fi

# A restart would cut a make off; the cabinet's own update refuses for the same reason (D195).
phase="$("$DRIVE" ssh 'node -e "fetch(\"http://127.0.0.1:8330/api/studio\").then(r => r.json()).then(s => console.log(s.phase), () => console.log(\"unknown\"))"' 2>/dev/null | tail -1 || true)"
if [ "$phase" = running ]; then echo "a make is running on the cabinet: try again when it's done" >&2; exit 4; fi

# Never call utmctl unless UTM is running: otherwise it launches UTM with its window.
if "$PGREP" -x UTM >/dev/null; then
  if [ "$("$UTMCTL" status arcade-virtual 2>/dev/null)" = started ]; then
    echo "stopping the cabinet cleanly"
    "$UTMCTL" stop --request arcade-virtual >/dev/null 2>&1 || true
    for _ in $(seq 1 24); do [ "$("$UTMCTL" status arcade-virtual 2>/dev/null)" = started ] || break; sleep 5; done
    [ "$("$UTMCTL" status arcade-virtual 2>/dev/null)" != started ] || "$UTMCTL" stop arcade-virtual >/dev/null 2>&1 || true
  fi
  echo "quitting UTM, so it reads the new config"
  "$OSASCRIPT" -e 'tell application id "com.utmapp.UTM" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do "$PGREP" -x UTM >/dev/null || break; sleep 1; done
  if "$PGREP" -x UTM >/dev/null; then echo "UTM didn't quit: quit it, then run this again. The config is unchanged." >&2; exit 3; fi
fi

copy="$CONFIG.before-mic-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$CONFIG" "$copy"
plutil -replace Virtualization.AudioInput -bool "$want" "$CONFIG"
plutil -lint -s "$CONFIG"
echo "microphone $1 (the config as it was: $copy)"
[ "$want" = true ] && echo "Geoff: macOS may ask whether UTM can use the microphone. Click Allow."

"$UP"
rc=0
"$VERIFY" "$OUT" || rc=$?
echo "the cabinet's capture devices:"
"$DRIVE" ssh 'arecord -l' 2>/dev/null || true
exit "$rc"

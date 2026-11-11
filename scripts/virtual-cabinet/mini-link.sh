#!/bin/bash
# D241: give the existing virtual cabinet its second card, the mini's private way in, without rebuilding it.
# Its disk, key and carts are untouched: this edits only UTM's config for the VM, and keeps a copy first.
#
#   scripts/virtual-cabinet/mini-link.sh --check   says "has it" or "doesn't have it"
#   scripts/virtual-cabinet/mini-link.sh           adds the card; UTM must not be running
#
# UTM reads a VM's config only when it starts (D148), so: stop the VM, quit UTM, run this, then up.sh.
# up.sh finds the card's address and points the driver there.
set -euo pipefail
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
CONFIG="$VM_ROOT/arcade-virtual.utm/config.plist"
MAC=5a:47:41:43:41:43
PGREP="${GSA_PGREP:-pgrep}"

[ -f "$CONFIG" ] || { echo "no VM config at $CONFIG" >&2; exit 1; }
has_card() {
  local i
  for i in 0 1 2 3; do
    [ "$(plutil -extract "Network.$i.MacAddress" raw -o - "$CONFIG" 2>/dev/null)" = "$MAC" ] && return 0
  done
  return 1
}

if [ "${1:-}" = --check ]; then
  if has_card; then echo "has it"; else echo "doesn't have it"; fi
  exit 0
fi
if has_card; then echo "the VM already has the mini's card"; exit 0; fi
if "$PGREP" -x UTM >/dev/null; then
  echo "UTM is running, and it would keep its cached config (D148). Stop the VM and quit UTM, then run this again." >&2
  exit 3
fi
[ "$(plutil -extract Network.0.Mode raw -o - "$CONFIG")" = Bridged ] || { echo "the VM's first card isn't bridged; this is for D152's VM" >&2; exit 1; }

copy="$CONFIG.before-mini-link-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$CONFIG" "$copy"
plutil -insert Network.1 -json "{\"Mode\":\"Shared\",\"MacAddress\":\"$MAC\"}" "$CONFIG"
plutil -lint -s "$CONFIG"
has_card
echo "added the mini's card ($MAC, shared). The config as it was: $copy"

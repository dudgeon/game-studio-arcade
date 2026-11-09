#!/bin/bash
# The one command that starts the virtual cabinet: builds the VM if there isn't
# one, starts it headless and waits for its first-boot provisioning to finish.
#
#   scripts/virtual-cabinet/up.sh [--network Bridged|Shared]
#
# First run on a Mac: UTM must have been opened once (D146), and `utmctl` may raise
# one "control UTM" Automation prompt. Geoff needs to be there for that.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
PACKAGE="$VM_ROOT/arcade-virtual.utm"
UTM=/Applications/UTM.app
UTMCTL="$UTM/Contents/MacOS/utmctl"
NETWORK=Bridged
[ "${1:-}" = "--network" ] && NETWORK="$2"

# macOS keeps the attribute after approval and sets the 0x40 flag: 0181 is unapproved, 01c1 approved.
q="$(xattr -p com.apple.quarantine "$UTM" 2>/dev/null || true)"
if [ -n "$q" ] && [ $(( 0x${q%%;*} & 0x40 )) -eq 0 ]; then
  cat >&2 <<MSG
UTM hasn't been cleared to run yet: starting it now would raise macOS's first-open dialog (D146).
Geoff: run "open $UTM", click Open, then quit UTM. Then run this again.
MSG
  exit 3
fi

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
[ -d "$PACKAGE" ] || node "$REPO/scripts/virtual-cabinet/build.mjs" --network "$NETWORK"

# Launch hidden at the OS level, then a plain start: that shows no window. Don't use utmctl's --hide:
# it asks UTM to close its window, which is refused here (-10004), and the window stays (D149).
open -gj "$UTM"
# UTM takes a while to load its list, and a slow start mustn't look like an unknown VM: that opens a window.
# Polls until UTM knows the VM, for up to about $1 tries.
vm_known() {
  for _ in $(seq 1 "$1"); do
    if "$UTMCTL" status arcade-virtual >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
quit_utm() {
  killall UTM 2>/dev/null || true
  for _ in $(seq 1 20); do pgrep -x UTM >/dev/null || return 0; sleep 1; done
  return 1
}
windows_clear() { swift "$REPO/scripts/virtual-cabinet/windows.swift" >/dev/null 2>&1; }

if [ -n "${ARCADE_TEST_FORCE_REGISTER:-}" ] || ! vm_known 15; then
  # Only the first time: opening the package registers it with UTM where it is. That can show UTM's
  # window, and nothing here can close it. So register, quit UTM before the VM starts, and launch hidden again.
  echo "registering the VM with UTM (a window may show for a few seconds)"
  open -gj -a "$UTM" "$PACKAGE"
  vm_known 15 || { quit_utm || true; echo "UTM didn't take the VM at $PACKAGE. UTM has been quit." >&2; exit 4; }
  quit_utm || { echo "UTM didn't quit, so its window may still be up. Quit UTM, then run this again." >&2; exit 4; }
  open -gj "$UTM"
  vm_known 15 || { quit_utm || true; echo "UTM didn't remember the VM after registering it. UTM has been quit." >&2; exit 4; }
fi
"$UTMCTL" start arcade-virtual
# Geoff's rule: no window left up (D149). Stop rather than leave one there.
sleep 2
if ! windows_clear; then
  echo "a UTM window is on screen after starting. Stopping the VM and quitting UTM rather than leaving it up." >&2
  "$UTMCTL" stop --request arcade-virtual >/dev/null 2>&1 || true
  for _ in $(seq 1 12); do [ "$("$UTMCTL" status arcade-virtual 2>/dev/null)" = started ] || break; sleep 5; done
  "$UTMCTL" stop arcade-virtual >/dev/null 2>&1 || true
  quit_utm || true
  exit 5
fi
# UTM caches a VM's config in memory (D148). A serial device the file doesn't have means a stale one.
if plutil -extract Serial.0 xml1 -o - "$PACKAGE/config.plist" >/dev/null 2>&1; then :
elif lsof -c UTM 2>/dev/null | grep -q /dev/ptmx; then
  echo "UTM is running a stale config for this VM: stop the VM, quit UTM, and run this again" >&2
  exit 1
fi

case "$NETWORK" in
  Bridged) export ARCADE_HOST="${ARCADE_HOST:-arcade-virtual.local}" ;;
  Shared)
    # The fixed MAC finds its lease in the mini's DHCP table. macOS drops leading zeros in that file.
    for _ in $(seq 1 60); do
      ip="$(awk '/ip_address=/{split($0,a,"=");i=a[2]} /hw_address=/{if($0 ~ /5a:47:41:43:41:42/){print i;exit}}' /var/db/dhcpd_leases 2>/dev/null || true)"
      [ -n "$ip" ] && break
      sleep 5
    done
    [ -n "${ip:-}" ] || { echo "no DHCP lease for the VM" >&2; exit 1; }
    export ARCADE_HOST="$ip"
    ;;
esac
echo "$ARCADE_HOST" > "$VM_ROOT/host"

echo "waiting for the cabinet at $ARCADE_HOST (first boot installs packages; allow up to 30 minutes)"
deadline=$(( $(date +%s) + 1800 ))
# Bridged on Wi-Fi, the mini sometimes can't reach a healthy guest until it restarts (D156). Provisioning
# takes under 5 minutes and can safely repeat, so 10 minutes of silence earns one restart.
restart_at=$(( $(date +%s) + 600 ))
heard=no
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ "$heard" = no ] && "$REPO/cabinet/vm/drive" ssh true 2>/dev/null; then heard=yes; fi
  if [ "$heard" = no ] && [ "$restart_at" != 0 ] && [ "$(date +%s)" -gt "$restart_at" ]; then
    echo "no answer from the cabinet after 10 minutes: restarting it once"
    restart_at=0
    "$UTMCTL" stop --request arcade-virtual >/dev/null 2>&1 || true
    for _ in $(seq 1 12); do [ "$("$UTMCTL" status arcade-virtual 2>/dev/null)" = started ] || break; sleep 5; done
    "$UTMCTL" stop arcade-virtual >/dev/null 2>&1 || true
    sleep 3
    "$UTMCTL" start arcade-virtual
  fi
  if "$REPO/cabinet/vm/drive" ssh test -f /etc/arcade/provisioned-version 2>/dev/null; then
    "$REPO/cabinet/vm/drive" status
    exit 0
  fi
  sleep 5
done
echo "timed out. Stop the VM and read seed/provision.log on the boot partition, or rebuild with build.mjs --serial-console and run serial.sh." >&2
exit 1

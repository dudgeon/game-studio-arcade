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
sleep 4
if ! "$UTMCTL" status arcade-virtual >/dev/null 2>&1; then
  # Only the first time: opening the package registers it with UTM where it is, and can show UTM's window.
  open -gj -a "$UTM" "$PACKAGE"
  sleep 4
fi
"$UTMCTL" start arcade-virtual
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
while [ "$(date +%s)" -lt "$deadline" ]; do
  if "$REPO/cabinet/vm/drive" ssh test -f /etc/arcade/provisioned-version 2>/dev/null; then
    "$REPO/cabinet/vm/drive" status
    exit 0
  fi
  sleep 5
done
echo "timed out. Stop the VM and read seed/provision.log on the boot partition, or rebuild with build.mjs --serial-console and run serial.sh." >&2
exit 1

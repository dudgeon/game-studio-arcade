#!/bin/bash
# The boot update's way back (D336), on a QEMU copy of the card, by hand, after update-rehearsal.sh (which installs it):
#
#   scripts/cabinet-card/test/boot-rehearsal.sh DIR
#
# QEMU has no Pi firmware, so "reboot 0 tryboot" restarts it normally, which is exactly a try that didn't come up:
#   revert   boot-update.mjs adopt: the cabinet restarts, the try isn't kept, config.txt is as it was, a result says so
#   keep     arcade-boot confirm on a copy of the boot partition, with a command line that names the slot: kept
# What only the Picade can show (tryboot itself, the watchdog) is bring-up F3.
set -u
[ -n "${1:-}" ] || { sed -n '2,12p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
fails=0
result() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
look() { local rc i; for i in $(seq 1 60); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 5; done; return 255; }

echo "=== revert: a try that doesn't come up is not kept"
config_before="$(look 'sha256sum /boot/firmware/config.txt | cut -c1-16')"
out="$("$N" "$REPO/scripts/cabinet-card/boot-update.mjs" adopt --rehearsal "$DIR" 2>&1)"; rc=$?
echo "$out" | tail -4
result revert-reported '[ "$rc" != 0 ] && echo "$out" | grep -q "didn.t come up"'
result revert-config-untouched '[ "$(look "sha256sum /boot/firmware/config.txt | cut -c1-16")" = "$config_before" ]'
result revert-slot-written 'look "ls -d /boot/firmware/arcade-*/overlays/README /boot/firmware/tryboot.txt" | grep -c . | grep -q 2'
result revert-slot-boots 'look "cat /boot/firmware/arcade-*/cmdline.txt" | grep -q "arcade.slot="'
result revert-service-up '[ "$(look "systemctl is-active arcade-launcher")" = active ]'
result revert-settled '[ "$(look "sudo test -e /var/lib/arcade-update/boot-try && echo yes || echo no")" = no ]'

echo "=== keep: a try that comes up well is kept (on a copy of the boot partition)"
look 'set -e
sudo rm -rf /tmp/bootcopy; sudo cp -R /boot/firmware /tmp/bootcopy
sudo rm -f /var/lib/arcade-update/boot-try
sudo ARCADE_BOOT_DIR=/tmp/bootcopy ARCADE_REBOOT_TRY=true /usr/local/lib/arcade-update/arcade-boot try >/dev/null
id=$(sudo sed -n "s/^id=//p" /var/lib/arcade-update/boot-try)
echo "$(cat /proc/cmdline) arcade.slot=$id" > /tmp/fake-cmdline
sudo ARCADE_BOOT_DIR=/tmp/bootcopy ARCADE_CMDLINE=/tmp/fake-cmdline /usr/local/lib/arcade-update/arcade-boot confirm' >/dev/null
r="$(look 'sudo cat /var/lib/arcade-update/boot-result.json; grep -A3 "BEGIN arcade boot slot" /tmp/bootcopy/config.txt')"
echo "$r" | head -12
result keep-result 'echo "$r" | grep -q "\"ok\": true" && echo "$r" | grep -q "kept arcade-"'
result keep-config 'echo "$r" | grep -q "^os_prefix=arcade-.*/$" && echo "$r" | grep -q "^kernel_watchdog_timeout=15$"'
result keep-rest-of-config '[ "$(look "sed /BEGIN\ arcade\ boot\ slot/,\\\$d /tmp/bootcopy/config.txt | sha256sum")" = "$(look "sha256sum < /boot/firmware/config.txt")" ]'
result keep-settled '[ "$(look "sudo test -e /var/lib/arcade-update/boot-try && echo yes || echo no")" = no ]'
look 'sudo rm -rf /tmp/bootcopy /tmp/fake-cmdline' >/dev/null
echo "failures: $fails"
exit "$fails"

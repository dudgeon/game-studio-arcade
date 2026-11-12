#!/bin/bash
# First boot, from the FAT seed (D143). Copies the provisioning script off FAT
# (which can't hold modes or symlinks) and runs it with the profile in the seed.
set -euo pipefail
# ARCADE_SEED, ARCADE_WORK and ARCADE_SCREEN are for its test (card.test.mjs).
SEED="${ARCADE_SEED:-/boot/firmware/seed}"
echo "=== firstboot $(date -u) ==="
PROFILE="$(cat "$SEED/profile")"
WORK="${ARCADE_WORK:-/opt/arcade/provision}"
rm -rf "$WORK.new"
install -d "$WORK.new"
tar -xzf "$SEED/provision.tar.gz" -C "$WORK.new"
rm -rf "$WORK"
mv "$WORK.new" "$WORK"
# The cabinet's screen says what's happening (D257). The kiosk isn't there yet, so this writes to the console
# on tty1, in a large font, over the login prompt and kernel messages. A VM with no screen just ignores it.
SCREEN="${ARCADE_SCREEN:-/dev/tty1}"
STARTED="$(date +%H:%M)"
systemctl stop getty@tty1.service 2>/dev/null || true
dmesg -n 1 2>/dev/null || true
setfont -C "$SCREEN" /usr/share/consolefonts/Lat15-TerminusBold32x16.psf.gz 2>/dev/null || true
show() {
  [ -w "$SCREEN" ] || return 0
  printf '\033[2J\033[H\033[?25l\n\n  Setting up the arcade\n\n  %s\n\n  %s\n\n  Started at %s. It restarts once when it is done.\n  Please leave it switched on.\n' "$1" "${2:-}" "$STARTED" >> "$SCREEN" 2>/dev/null || true
}
show "Getting ready" ""
if ! /bin/bash "$WORK/provision.sh" --profile "$PROFILE" --payload "$SEED" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    *"] == "*) step="${line#*] == }"; show "Step ${step%% *}" "${step#* }" ;;
  esac
done; then
  show "Setup stopped." "Tell a grown-up. The details are in seed/provision.log on the card."
  exit 1
fi
show "Done." "Restarting..."
echo "=== firstboot ok $(date -u) ==="
touch "$SEED/provision.ok"
# The picade profile asks for one restart when it changed config.txt (D250): its overlay and screen power
# only start at boot. The virtual profile never asks.
if [ -f /run/arcade-reboot-wanted ]; then
  echo "=== firstboot: restarting once for the new boot config $(date -u) ==="
  systemctl reboot --no-block
fi

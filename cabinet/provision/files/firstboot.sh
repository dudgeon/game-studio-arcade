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
# Minutes since power-on, not a clock time: the Pi has no battery clock, so until NTP answers its clock says the
# image's date (D257). /proc/uptime counts from boot whatever the clock says. ARCADE_UPTIME is for the test.
UPTIME="${ARCADE_UPTIME:-/proc/uptime}"
STEP_FILE="$(mktemp)"
systemctl stop getty@tty1.service 2>/dev/null || true
dmesg -n 1 2>/dev/null || true
# systemd's own "[ OK ] Started ..." lines go to the console too; stop them for this boot (SIGRTMIN+21, systemd(1)).
[ -z "${ARCADE_SCREEN:-}" ] && kill -s RTMIN+21 1 2>/dev/null || true
setfont -C "$SCREEN" /usr/share/consolefonts/Lat15-TerminusBold32x16.psf.gz 2>/dev/null || true
on_for() {
  local s m
  s="$(cut -d. -f1 "$UPTIME" 2>/dev/null)"
  m=$(( ${s:-0} / 60 ))
  case "$m" in 0) echo "less than a minute" ;; 1) echo "1 minute" ;; *) echo "$m minutes" ;; esac
}
# Draws the step held in STEP_FILE. show() changes the step; the ticker redraws every 30 s so the minutes move.
draw() {
  [ -w "$SCREEN" ] || return 0
  local a b
  { IFS= read -r a; IFS= read -r b; } < "$STEP_FILE"
  # The console is 64 columns in this font at 1024x768: every line here stays under that (card.test.mjs checks).
  printf '\033[2J\033[H\033[?25l\n\n  Setting up the arcade\n\n  %s\n\n  %s\n\n  Switched on %s ago.\n  It restarts once when it is done.\n  Please leave it switched on.\n' "$a" "$b" "$(on_for)" >> "$SCREEN" 2>/dev/null || true
}
show() {
  printf '%s\n%s\n' "$1" "${2:-}" > "$STEP_FILE"
  draw
}
show "Getting ready" ""
# The ticker sleeps in the background and waits, so a TERM stops it at once and takes its sleep with it: nothing
# of first boot is left running when the restart comes.
( trap 'kill "$nap" 2>/dev/null; exit 0' TERM
  while :; do sleep "${ARCADE_TICK_S:-30}" & nap=$!; wait "$nap"; draw; done ) </dev/null >/dev/null 2>&1 &
TICKER=$!
stop_ticker() {
  kill "$TICKER" 2>/dev/null || true
  wait "$TICKER" 2>/dev/null || true
}
# First boot's own exit status, in its log: the Picade's journal doesn't outlive the restart.
trap 'rc=$?; stop_ticker; rm -f "$STEP_FILE"; echo "=== firstboot exit $rc $(date -u) ==="' EXIT
if ! /bin/bash "$WORK/provision.sh" --profile "$PROFILE" --payload "$SEED" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    *"] == "*) step="${line#*] == }"; show "Step ${step%% *}" "${step#* }" ;;
  esac
done; then
  stop_ticker
  show "Setup stopped." "Tell a grown-up. Details: seed/provision.log"
  exit 1
fi
stop_ticker
show "Done." "Restarting..."
echo "=== firstboot ok $(date -u) ==="
# D359: speech's wheels and model (about 324 MB) are installed in /opt/arcade/speech now, so the card's copy only
# fills the boot partition. A re-run of provisioning doesn't need it (speech.sh skips what's installed), and first
# boot never runs again once it has succeeded. Only after a full success; a failed first boot keeps it for the retry.
if [ -d "$SEED/speech" ] && [ -f "${ARCADE_SPEECH_JSON:-/opt/arcade/speech/speech.json}" ]; then
  freed="$(du -sm "$SEED/speech" 2>/dev/null | cut -f1)"
  rm -rf "$SEED/speech" && sync && echo "=== firstboot: removed speech's install files from the card, ${freed:-?} MB freed ==="
fi
touch "$SEED/provision.ok"
# The picade profile asks for one restart when it changed config.txt (D250): its overlay and screen power
# only start at boot. The virtual profile never asks.
# The restart is scheduled a few seconds out, so this script finishes and logs its exit first: a restart asked
# for now would stop this unit mid-script (the rehearsal of 2026-11-12 showed it). ARCADE_RESTART is for the test.
if [ -f "${ARCADE_REBOOT_FLAG:-/run/arcade-reboot-wanted}" ]; then
  echo "=== firstboot: restarting once for the new boot config, in 5 s $(date -u) ==="
  ${ARCADE_RESTART:-systemd-run --quiet --unit=arcade-firstboot-restart --on-active=5 /usr/bin/systemctl reboot} \
    || systemctl reboot --no-block
fi

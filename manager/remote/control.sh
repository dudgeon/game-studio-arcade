#!/bin/bash
# The cabinet's controls from the Manager (D366, D367). Sent over SSH each time and run as root
# (sudo -n bash -s -- ACTION [ARG]), so a cabinet needs nothing new installed. Prints one JSON object.
#
#   volume                 the speaker's volume now: {"speaker": true, "percent": N} or {"speaker": false}
#   volume N               set it to N% (0-100) and keep it across restarts (alsactl store)
#   busy                   why the cabinet is busy, from the update's own check (D332), or ""
#   restart-shelf          restart the service and the kiosk: the shelf comes back in about 10 s
#   reboot                 restart the cabinet
#   poweroff               switch it off; it comes back only with its power switch (or, the VM, up.sh)
# restart-shelf, reboot and poweroff are refused while busy: a make running or to collect, a game, a gate check.
set -uo pipefail
CARD="${ARCADE_SOUND_CARD:-sndrpihifiberry}"
LIB="${ARCADE_UPDATE_LIB:-/usr/local/lib/arcade-update/update-lib.sh}"
action="${1:-}"
arg="${2:-}"

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

percent() { amixer -c "$CARD" sget PCM 2>/dev/null | sed -n 's/.*\[\([0-9]*\)%\].*/\1/p' | head -1; }

has_card() { aplay -l 2>/dev/null | grep -q "$CARD"; }

# The softvol control appears once something has played through it; a moment of silence makes it.
ensure_control() {
  amixer -c "$CARD" sget PCM >/dev/null 2>&1 && return 0
  timeout 2 aplay -q -D default -f S16_LE -r 44100 -c 2 -d 1 /dev/zero >/dev/null 2>&1 || true
  amixer -c "$CARD" sget PCM >/dev/null 2>&1
}

busy() {
  if [ ! -f "$LIB" ]; then echo "UNKNOWN"; return; fi
  # shellcheck source=/dev/null
  . "$LIB"
  busy_reason
}

case "$action" in
  volume)
    if ! has_card; then echo '{"speaker": false}'; exit 0; fi
    if [ -n "$arg" ]; then
      case "$arg" in *[!0-9]*) echo '{"error": "volume is a whole number, 0 to 100"}'; exit 2 ;; esac
      [ "$arg" -le 100 ] || { echo '{"error": "volume is 0 to 100"}'; exit 2; }
      ensure_control || { echo '{"error": "the speaker has no volume control yet"}'; exit 1; }
      amixer -q -c "$CARD" sset PCM "${arg}%" || { echo '{"error": "amixer refused"}'; exit 1; }
      /usr/sbin/alsactl store "$CARD" 2>/dev/null || /usr/sbin/alsactl store 2>/dev/null || true
    fi
    p="$(percent)"
    echo "{\"speaker\": true, \"percent\": ${p:-null}}"
    ;;
  busy)
    echo "{\"busy\": $(json_str "$(busy)")}"
    ;;
  restart-shelf | reboot | poweroff)
    why="$(busy)"
    if [ "$why" = UNKNOWN ]; then echo '{"ok": false, "why": "this cabinet'"'"'s software is too old to check whether someone is playing: update it first"}'; exit 0; fi
    if [ -n "$why" ]; then echo "{\"ok\": false, \"why\": $(json_str "$why: nothing was changed")}"; exit 0; fi
    case "$action" in
      restart-shelf) systemctl restart arcade-launcher arcade-kiosk ;;
      # A moment later, so this answer gets back to the Manager first.
      reboot) systemd-run --quiet --on-active=2 /bin/systemctl reboot ;;
      poweroff) systemd-run --quiet --on-active=2 /bin/systemctl poweroff ;;
    esac
    echo "{\"ok\": true, \"done\": \"$action\"}"
    ;;
  *) echo '{"error": "unknown action"}'; exit 2 ;;
esac

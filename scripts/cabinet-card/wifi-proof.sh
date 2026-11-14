#!/bin/bash
# Proof that the cabinet's Wi-Fi comes back by itself (D418): after each start, how many seconds from power-on
# until wlan0 was on its network, read from the cabinet's own journal. By hand, on the mini:
#
#   scripts/cabinet-card/wifi-proof.sh restarts [N=5]   restart the cabinet N times itself (a clean restart each)
#   scripts/cabinet-card/wifi-proof.sh cycles [N=10]    wait for N power cycles that a person does at the cabinet:
#                                                       it says when to pull the plug and counts each new boot
#   scripts/cabinet-card/wifi-proof.sh now              this boot's line only
#
# A boot passes when Wi-Fi was up within LIMIT seconds of power-on (default 60) and the cabinet answers the mini.
# It reaches the Picade as everything else does (cabinet/vm/drive, D416). ARCADE_HOST, ARCADE_SSH_PORT,
# ARCADE_SSH_DIR and ARCADE_SSH_KEY_NAME point it at a rehearsal instead. Results go to OUT (default
# wifi-proof/<time>.log in the Picade's folder on the mini). It changes nothing on the cabinet but the restarts.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=picade-ssh.sh
. "$HERE/picade-ssh.sh"
export ARCADE_HOST="${ARCADE_HOST:-$PICADE_HOST}"
export ARCADE_SSH_DIR="${ARCADE_SSH_DIR:-$PICADE_DIR/ssh}"
export ARCADE_SSH_KEY_NAME="${ARCADE_SSH_KEY_NAME:-$PICADE_KEY_NAME}"
export ARCADE_RIDE_S=1 ARCADE_SSH_TIMEOUT_S=25
D="$REPO/cabinet/vm/drive"
LIMIT="${LIMIT:-60}"
MODE="${1:-}"
OUT="${OUT:-$PICADE_DIR/wifi-proof/$(date +%Y-%m-%dT%H%M%S).log}"
mkdir -p "$(dirname "$OUT")"

# "BOOT_ID SECONDS_TO_WIFI UPTIME STATE": SECONDS is when NetworkManager first had wlan0 activated this boot.
PROBE='b=$(cat /proc/sys/kernel/random/boot_id)
t=$(journalctl -b -o short-monotonic -u NetworkManager --no-pager 2>/dev/null | sed -n "s/^\[ *\([0-9]*\)\.[0-9]*\].*device (wlan0): state change: .* -> activated.*/\1/p" | head -1)
echo "$b ${t:-none} $(cut -d. -f1 /proc/uptime) $(nmcli -t -f DEVICE,STATE,CONNECTION device status | sed -n "s/^wlan0://p")"'

probe() { "$D" ssh "$PROBE" 2>/dev/null; }

# Waits for a boot other than $1 to answer, then for its Wi-Fi (or LIMIT + 60 s of uptime). Prints its line.
next_boot() {
  local last="$1" line id t up i
  for i in $(seq 1 200); do
    line="$(probe)" || { sleep 3; continue; }
    read -r id t up _ <<<"$line"
    [ -n "${id:-}" ] && [ "$id" != "$last" ] || { sleep 3; continue; }
    [ "$t" != none ] || [ "${up:-0}" -gt $((LIMIT + 60)) ] && { echo "$line"; return 0; }
    sleep 3
  done
  return 1
}

fails=0
n=0
record() { # LINE WHAT
  local id t up state res
  read -r id t up state <<<"$1"
  n=$((n + 1))
  if [ "$t" != none ] && [ "$t" -le "$LIMIT" ] && [ "${state%%:*}" = connected ]; then res=PASS; else res=FAIL; fails=$((fails + 1)); fi
  echo "$res $2 $n: Wi-Fi up ${t} s after power-on (limit $LIMIT s); now $state; found by the mini $up s after power-on" | tee -a "$OUT"
}

case "$MODE" in
  now)
    line="$(probe)" || { echo "the cabinet doesn't answer"; exit 1; }
    record "$line" "this boot"
    ;;
  restarts)
    N="${2:-5}"
    for _ in $(seq 1 "$N"); do
      line="$(probe)" || { echo "the cabinet doesn't answer"; exit 1; }
      "$D" ssh "sudo systemctl reboot" >/dev/null 2>&1
      line="$(next_boot "${line%% *}")" || { echo "FAIL restart $((n + 1)): the cabinet didn't come back in 10 minutes" | tee -a "$OUT"; fails=$((fails + 1)); n=$((n + 1)); continue; }
      record "$line" restart
    done
    ;;
  cycles)
    N="${2:-10}"
    line="$(probe)" || { echo "the cabinet doesn't answer"; exit 1; }
    for _ in $(seq 1 "$N"); do
      echo ">>> Power cycle $((n + 1)) of $N: switch the cabinet off and on now (pull the plug, or hold the power button)."
      line="$(next_boot "${line%% *}")" || { echo "FAIL power cycle $((n + 1)): no new boot seen in 10 minutes" | tee -a "$OUT"; fails=$((fails + 1)); n=$((n + 1)); line="x"; continue; }
      record "$line" "power cycle"
    done
    ;;
  *) sed -n '2,14p' "$0" >&2; exit 2 ;;
esac
echo "failures: $fails of $n (log: $OUT)"
exit "$fails"

#!/bin/bash
# D243's soak: does the mini's private card (D241) stay up while the bridged path drops?
# Every 5 s, from the mini: a new TCP connection to the cabinet's SSH port on each path, and a command
# through an SSH connection held open over the private card. At the end it copies the cabinet's own
# record (D242) for the whole soak. Changes nothing on the cabinet, and stops early on Ctrl-C with what it has.
#
# The cabinet may be restarted on purpose during a soak. Rounds with both paths down are marked
# "restart?" and counted apart; the boots the cabinet's journal lists for the soak's hours say which were
# restarts. The held connection is reopened afterwards, and each reopening is logged.
# A second run with the same OUTDIR appends, so a soak can be carried on by a newer copy of this script.
#
#   scripts/virtual-cabinet/path-soak.sh OUTDIR HOURS
set -u
OUT="${1:?usage: path-soak.sh OUTDIR HOURS}"; HOURS="${2:?}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
KEY="$VM_ROOT/ssh/arcade-virtual_ed25519"
LINK="$(/opt/homebrew/opt/node@22/bin/node "$REPO/scripts/virtual-cabinet/vm-addr.mjs")" || { echo "the VM has no private card yet (D241)" >&2; exit 1; }
BRIDGED="$(dscacheutil -q host -a name arcade-virtual.local | sed -n 's/^ip_address: \([0-9.]*\)$/\1/p' | grep -v '^192\.168\.64\.' | head -1)"
[ -n "$BRIDGED" ] || { echo "couldn't find the bridged address" >&2; exit 1; }
CONTROL="$(mktemp -d)/c"
SSH=(ssh -4 -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=10 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$VM_ROOT/ssh/known_hosts" -S "$CONTROL")
mkdir -p "$OUT"
LOG="$OUT/mini.log"
echo "$(date -u +%FT%TZ) start bridged=$BRIDGED link=$LINK hours=$HOURS" | tee -a "$LOG"
# The record covers the whole soak, from the first run's start.
FIRST="$(awk '$2 == "start" {print $1; exit}' "$LOG" | sed 's/T/ /; s/Z$//')"

master_alive() { "${SSH[@]}" -O check "cabinet@$LINK" >/dev/null 2>&1; }
open_master() { "${SSH[@]}" -M -N -f "cabinet@$LINK" 2>/dev/null; }
open_master || { echo "couldn't open the held connection over the private card" >&2; exit 1; }

on_cabinet() { "${SSH[@]}" -o ControlMaster=no "cabinet@$LINK" "$@"; }
finish() {
  for _ in $(seq 1 12); do
    on_cabinet "sudo journalctl -u arcade-netwatch --since '$FIRST' --no-pager -o short-iso" > "$OUT/netwatch.log" 2>/dev/null &&
      on_cabinet "journalctl --list-boots --no-pager" > "$OUT/boots.txt" 2>/dev/null && break
    sleep 5
  done
  "${SSH[@]}" -O exit "cabinet@$LINK" 2>/dev/null
  summary
  exit 0
}
summary() {
  {
    awk '$2 == "start" || $2 == "held-reopened" { next }
         $0 ~ /restart\?/ { r++; next }
         { for (i = 2; i <= NF; i++) { split($i, kv, "="); n[kv[1]]++; if (kv[2] == "up") u[kv[1]]++ } }
         END { for (k in n) printf "%s %d/%d up\n", k, u[k], n[k]; printf "rounds with both paths down (restart?): %d\n", r }' "$LOG" | sort
    echo "held connection reopened: $(grep -c held-reopened "$LOG")"
    echo "boots in the cabinet's journal:"; cat "$OUT/boots.txt" 2>/dev/null
  } | tee "$OUT/summary.txt"
}
trap finish INT TERM

END=$(( $(date +%s) + ${HOURS%.*} * 3600 ))
while [ "$(date +%s)" -lt "$END" ]; do
  b=DOWN; /usr/bin/nc -z -G 3 "$BRIDGED" 22 >/dev/null 2>&1 && b=up
  l=DOWN; /usr/bin/nc -z -G 3 "$LINK" 22 >/dev/null 2>&1 && l=up
  h=DOWN
  if master_alive; then on_cabinet true >/dev/null 2>&1 && h=up
  elif [ "$l" = up ] && open_master; then echo "$(date -u +%FT%TZ) held-reopened" >> "$LOG"
  fi
  mark=""; [ "$b" = DOWN ] && [ "$l" = DOWN ] && mark=" restart?"
  echo "$(date -u +%FT%TZ) bridged=$b link=$l held=$h$mark" >> "$LOG"
  sleep 5
done
finish

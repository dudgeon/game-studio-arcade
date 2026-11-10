#!/bin/bash
# Where do the mini-to-VM gaps live (D156)? Logs one line every 5 s, from the mini and from the guest:
#   new      a new TCP connection to the guest's SSH port
#   held     a command through one SSH connection held open throughout, and how long it took
#   router   the mini's ping to its router
#   peer     the mini's ping to another device on the home network
# and, from the guest, the router, the same device, and what it thinks the mini's address is.
# Only reachability and low-rate pings. Changes nothing, and needs no key.
#
#   scripts/virtual-cabinet/gap-measure.sh OUTDIR MINUTES PEER_IP
set -u
OUT="${1:?usage: gap-measure.sh OUTDIR MINUTES PEER_IP}"; MINUTES="${2:?}"; PEER="${3:?}"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
HOST="$(cat "$VM_ROOT/host" 2>/dev/null || echo arcade-virtual.local)"
KEY="$VM_ROOT/ssh/arcade-virtual_ed25519"
CONTROL="$(mktemp -d)/c"
SSH=(ssh -4 -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$VM_ROOT/ssh/known_hosts" -S "$CONTROL")
ROUTER="$(route -n get default 2>/dev/null | sed -n 's/.*gateway: //p')"
mkdir -p "$OUT"
LOG="$OUT/mini.log"

until "${SSH[@]}" -M -N -f "cabinet@$HOST" 2>/dev/null; do sleep 5; done
IP="$(dscacheutil -q host -a name "$HOST" | sed -n 's/^ip_address: //p' | head -1)"
MINI_IP="$(ifconfig en1 | sed -n 's/.*inet \([0-9.]*\) .*/\1/p' | head -1)"
echo "$(date -u +%FT%TZ) start guest=$IP router=$ROUTER peer=$PEER mini=$MINI_IP" | tee -a "$LOG"

# The guest's side, in a transient unit, logging to /tmp.
"${SSH[@]}" "cabinet@$HOST" "sudo systemctl stop arcade-gapwatch 2>/dev/null; sudo systemctl reset-failed arcade-gapwatch 2>/dev/null; cat > /tmp/arcade-gapwatch.sh; chmod +x /tmp/arcade-gapwatch.sh; sudo systemd-run --quiet --unit=arcade-gapwatch /tmp/arcade-gapwatch.sh $ROUTER $PEER $MINI_IP" <<'GUEST'
#!/bin/bash
L=/tmp/arcade-gapwatch.log
while true; do
  r=DOWN; ping -c1 -W2 "$1" >/dev/null 2>&1 && r=up
  p=DOWN; ping -c1 -W2 "$2" >/dev/null 2>&1 && p=up
  n="$(ip neigh show "$3" | awk '{print $NF}')"
  echo "$(date -u +%FT%TZ) router=$r peer=$p mini-neigh=${n:-none}" >> "$L"
  sleep 5
done
GUEST

# A command through the held connection, in the background so a stall doesn't hold up the other probes.
held_out="$OUT/held.log"
(
  while true; do
    s="$(/opt/homebrew/opt/node@22/bin/node -p 'Date.now()')"
    if "${SSH[@]}" -o ControlMaster=no "cabinet@$HOST" true 2>/dev/null; then r=ok; else r="FAIL$?"; fi
    e="$(/opt/homebrew/opt/node@22/bin/node -p 'Date.now()')"
    echo "$(date -u +%FT%TZ) held=$r ms=$((e - s)) master=$("${SSH[@]}" -O check "cabinet@$HOST" >/dev/null 2>&1 && echo alive || echo DEAD)" >> "$held_out"
    sleep 5
  done
) &
held_pid=$!

END=$(( $(date +%s) + MINUTES * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  n=DOWN; /usr/bin/nc -z -G 3 "$IP" 22 >/dev/null 2>&1 && n=up
  r=DOWN; ping -c1 -t2 "$ROUTER" >/dev/null 2>&1 && r=up
  p=DOWN; ping -c1 -t2 "$PEER" >/dev/null 2>&1 && p=up
  echo "$(date -u +%FT%TZ) new=$n router=$r peer=$p" >> "$LOG"
  sleep 5
done
kill "$held_pid" 2>/dev/null

# Fetch the guest's log. It may take a few tries if a gap is on.
for _ in $(seq 1 30); do
  if "${SSH[@]}" "cabinet@$HOST" 'cat /tmp/arcade-gapwatch.log' > "$OUT/guest.log" 2>/dev/null && [ -s "$OUT/guest.log" ]; then break; fi
  sleep 5
done
for _ in $(seq 1 30); do
  "${SSH[@]}" "cabinet@$HOST" 'sudo systemctl stop arcade-gapwatch; sudo rm -f /tmp/arcade-gapwatch.sh /tmp/arcade-gapwatch.log' 2>/dev/null && break
  sleep 5
done
"${SSH[@]}" -O exit "cabinet@$HOST" 2>/dev/null
echo "$(date -u +%FT%TZ) done: $OUT"

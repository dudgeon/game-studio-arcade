#!/bin/bash
# Everyday power cuts, rehearsed on a QEMU copy of the Picade's card (D371). By hand, on the mini, after
# rehearse.mjs prepare + start and the first boot (as for update-rehearsal.sh):
#
#   scripts/cabinet-card/test/power-rehearsal.sh DIR [ROUNDS=20]
#
# It switches the rehearsal cabinet's service to replay with a throwaway Manager token, so makes run with no API
# and no spend, then each round runs power-workload.mjs (makes that commit carts, coin top-ups, new makers, plays)
# and pulls the plug at a random moment (QEMU quits: nothing is flushed). After each boot: the shelf must come
# back, and power-check.mjs must find everything the service ever acknowledged, whole: the cart library sound and
# committed, the coin ledger, makers.json, the play log, every JSON file parseable. REHEARSE_SSH_PORT as usual.
# Never touches the virtual cabinet or the Picade.
set -u
[ -n "${1:-}" ] || { sed -n '2,13p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
ROUNDS="${2:-20}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
OUT="$DIR/power"
TOKEN=rehearsal-power-token
mkdir -p "$OUT"; : > "$OUT/acks.log"; : > "$OUT/rounds.log"
look() { local rc i; for i in $(seq 1 90); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 4; done; return 255; }
up() { # the shelf back: the service answers and the kiosk runs
  local i
  for i in $(seq 1 75); do
    [ "$(look 'systemctl is-active arcade-launcher arcade-kiosk | tr "\n" " "; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8330/api/config')" = "active active 200" ] && return 0
    sleep 4
  done
  return 1
}

echo "=== setup: replay with a throwaway Manager token; the workload and the check on the cabinet"
look "sudo install -d /opt/power-rehearsal && echo 'ARCADE_SERVICE_ARGS=--replay /opt/arcade/current/studio-kit/cli/fixtures/penguin-catch --manager-token $TOKEN' | sudo tee /etc/arcade/service.env >/dev/null && sudo systemctl restart arcade-launcher" >/dev/null
for f in power-workload.mjs power-check.mjs; do "$D" ssh "sudo tee /opt/power-rehearsal/$f >/dev/null" < "$REPO/scripts/cabinet-card/test/$f"; done
up || { echo "the service didn't come up on replay"; exit 1; }
# Carts already there and not in a library commit (provisioning's starters): not the cuts' doing.
for c in $(look 'cd /var/lib/arcade/carts && for d in */; do d=${d%/}; git -c safe.directory=* ls-tree --name-only HEAD 2>/dev/null | grep -qx "$d" || echo "$d"; done'); do echo "ACK starter {\"id\":\"$c\"}" >> "$OUT/acks.log"; done
first="$("$D" ssh "node /opt/power-rehearsal/power-check.mjs /var/lib/arcade http://127.0.0.1:8330" < "$OUT/acks.log")"
echo "before any cut: $first"

fails=0
for i in $(seq 1 "$ROUNDS"); do
  wait_s=$(( 4 + RANDOM % 50 ))
  "$D" ssh "node /opt/power-rehearsal/power-workload.mjs http://127.0.0.1:8330 $TOKEN $RANDOM$i" > "$OUT/round-$i.log" 2>/dev/null &
  w=$!
  sleep "$wait_s"
  during="$(grep -E '^(BEGIN|ACK)' "$OUT/round-$i.log" | tail -1)"
  case "$during" in BEGIN*) during="mid-${during#BEGIN }" ;; *) during="between steps" ;; esac
  "$N" "$REPO/scripts/cabinet-card/rehearse.mjs" stop "$DIR" >/dev/null 2>&1
  kill "$w" 2>/dev/null; wait "$w" 2>/dev/null
  grep '^ACK ' "$OUT/round-$i.log" >> "$OUT/acks.log"
  sleep 2
  "$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null
  t0=$(date +%s)
  if up; then shelf="shelf in $(( $(date +%s) - t0 )) s"; else shelf="NO SHELF after 300 s"; fi
  # A make the cut stopped is collected at start (D191); let that finish before checking.
  for _ in $(seq 1 30); do look 'curl -s http://127.0.0.1:8330/api/studio' | grep -q '"collecting":true' || break; sleep 2; done
  check="$("$D" ssh "node /opt/power-rehearsal/power-check.mjs /var/lib/arcade http://127.0.0.1:8330" < "$OUT/acks.log" 2>/dev/null)"
  steps="$(grep -c '^ACK ' "$OUT/round-$i.log")"
  if echo "$check" | grep -q '"ok":true' && [ "${shelf#NO}" = "$shelf" ]; then res=PASS; else res=FAIL; fails=$((fails + 1)); fi
  line="$res round $i: cut at ${wait_s} s, $during, after $steps steps; $shelf; $check"
  echo "$line" | tee -a "$OUT/rounds.log" | cut -c1-400
done
echo "failures: $fails of $ROUNDS (details: $OUT)"
exit "$fails"

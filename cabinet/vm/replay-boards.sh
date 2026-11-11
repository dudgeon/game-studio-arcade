#!/bin/bash
# Drives the arcade's boards on the virtual cabinet itself, against a replay (D186, D213):
# the cabinet's own service, its own launcher files and its own Chromium, on port 8331
# with a data folder in /tmp, so nothing touches /var/lib/arcade or the kiosk on 8330.
# The mini drives it over an SSH tunnel to Chromium's DevTools port; screenshots land here.
#
#   cabinet/vm/replay-boards.sh OUT [FLOW...]     default: every flow in cabinet/service/scripts/flows
#
# Each flow gets a fresh /tmp/arcade-replay/<flow>, seeded on the cabinet as its script says.
# Everything it started on the cabinet is stopped at the end, whatever happened.
set -uo pipefail

OUT="${1:?usage: replay-boards.sh OUT [FLOW...]}"
shift
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${ARCADE_HOST:-arcade-virtual.local}"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
KEY="$VM_ROOT/ssh/arcade-virtual_ed25519"
SSHO=(-4 -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$VM_ROOT/ssh/known_hosts")
APP=/opt/arcade/current
FIX=$APP/studio-kit/cli/fixtures/penguin-catch
FLOWS=("$@")
[ ${#FLOWS[@]} -eq 0 ] && FLOWS=(first-boot new-month arcade pot-low pot-empty overrun over-usual failed resting offline errors)
export PATH=/opt/homebrew/opt/node@22/bin:$PATH

on() { perl -e 'alarm shift; exec @ARGV' 120 ssh "${SSHO[@]}" "cabinet@$HOST" "$@"; }

# The service for one flow, on the cabinet. Its flags and seed come from the script's own #! and #seed lines.
start_service() {
  local flow="$1" args seed
  args="$(grep '^#!' "$REPO/cabinet/service/scripts/flows/$flow.drive" | sed 's/^#!//' | tr '\n' ' ')"
  seed="$(grep '^#seed ' "$REPO/cabinet/service/scripts/flows/$flow.drive" | sed 's/^#seed //')"
  on "pkill -f 'cabinet-service.js --port 8331' ; sleep 0.3; rm -rf /tmp/arcade-replay/$flow; mkdir -p /tmp/arcade-replay/$flow"
  if [ -n "$seed" ]; then
    on "cd $APP/cabinet/service && node -e 'const fs=require(\"fs\");import(\"./scripts/drive.js\").then(m=>m.plantSeed(\"/tmp/arcade-replay/$flow\", JSON.parse(fs.readFileSync(0,\"utf8\"))))'" < "$REPO/cabinet/service/scripts/flows/$seed"
  fi
  # The restart command for `restart` steps: the same service, the same data, after DOWN_MS.
  on "cat > /tmp/arcade-replay/$flow.run" <<EOF
#!/bin/bash
cd $APP && exec node cabinet/service/bin/cabinet-service.js --port 8331 --guest-port 0 --data /tmp/arcade-replay/$flow --replay $FIX --pace 20 --manager-token drive-manager-token $args
EOF
  on "chmod +x /tmp/arcade-replay/$flow.run; nohup /tmp/arcade-replay/$flow.run > /tmp/arcade-replay/$flow.log 2>&1 < /dev/null & for i in \$(seq 1 50); do grep -q 'cabinet service on' /tmp/arcade-replay/$flow.log && exit 0; sleep 0.2; done; cat /tmp/arcade-replay/$flow.log; exit 1"
}

cleanup() {
  [ -n "${TUNNEL:-}" ] && kill "$TUNNEL" 2>/dev/null
  on "pkill -f 'cabinet-service.js --port 8331'; pkill -f 'remote-debugging-port=9222'; true" >/dev/null 2>&1
}
trap cleanup EXIT

on "pkill -f 'remote-debugging-port=9222'; rm -rf /tmp/arcade-replay-chrome; nohup chromium --headless=new --no-first-run --remote-debugging-port=9222 --user-data-dir=/tmp/arcade-replay-chrome --window-size=1024,768 about:blank > /tmp/arcade-replay-chrome.log 2>&1 < /dev/null & sleep 2; curl -s http://127.0.0.1:9222/json/version | head -3" || { echo "no Chromium on the cabinet"; exit 1; }
ssh "${SSHO[@]}" -N -L 8331:127.0.0.1:8331 -L 9222:127.0.0.1:9222 "cabinet@$HOST" &
TUNNEL=$!
sleep 2

mkdir -p "$OUT"
status=0
for flow in "${FLOWS[@]}"; do
  if ! start_service "$flow"; then echo "FAIL $flow: the service didn't start"; status=1; continue; fi
  restart="perl -e 'alarm shift; exec @ARGV' 120 ssh ${SSHO[*]} cabinet@$HOST \"pkill -9 -f 'cabinet-service.js --port 8331'; sleep \\\$((\$DOWN_MS / 1000)); nohup /tmp/arcade-replay/$flow.run >> /tmp/arcade-replay/$flow.log 2>&1 < /dev/null & sleep 2\""
  rm -rf "$OUT/$flow"
  if GSA_MANAGER_TOKEN=drive-manager-token node "$REPO/cabinet/service/scripts/drive.js" --script "$REPO/cabinet/service/scripts/flows/$flow.drive" --out "$OUT/$flow" \
      --url http://127.0.0.1:8331 --cdp http://127.0.0.1:9222 --restart-cmd "$restart" > "$OUT/$flow.log" 2>&1; then
    echo "PASS $flow ($(grep -o 'Boards: .*' "$OUT/$flow.log" | cut -c9-))"
  else
    echo "FAIL $flow: $(tail -1 "$OUT/$flow.log")"
    status=1
  fi
done
exit $status

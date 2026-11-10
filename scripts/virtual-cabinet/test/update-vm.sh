#!/bin/bash
# The in-place update on a real cabinet, run by hand (D195). update.test.mjs covers what needs no cabinet.
# A stand-in key only: no Console, no spend.
#
#   scripts/virtual-cabinet/test/update-vm.sh --yes-this-is-a-test-cabinet
#
# It installs a fake key and a test cart, updates over them twice (the second time to a changed bundle), and
# checks that carts, logs and config came through, the version moved, the old release stayed, and an update
# is refused while a make runs. It stops if the cabinet already has a key file, so it can't touch a real one.
# It removes the fake key and test cart at the end, and leaves the old releases, which are never deleted.
set -u
[ "${1:-}" = "--yes-this-is-a-test-cabinet" ] || { sed -n '2,10p' "$0" >&2; exit 2; }
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
D="$REPO/cabinet/vm/drive"
N=/opt/homebrew/opt/node@22/bin/node
UP="$REPO/scripts/virtual-cabinet/update-cabinet.mjs"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"
T="$(mktemp -d)"
MARK="$REPO/cabinet/vm/guest/update-test-marker.txt"
trap 'rm -rf "$T"; rm -f "$MARK"' EXIT

fails=0
result() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
# Looks only, so it may repeat while SSH itself fails.
look() { local rc; for _ in $(seq 1 60); do "$D" run "$1" 2>/dev/null; rc=$?; [ "$rc" = 255 ] || return "$rc"; sleep 5; done; return 255; }

cat > "$T/has-key.sh" <<'EOF'
sudo test -e /etc/arcade/service.json && echo KEY_FILE || echo none
EOF
[ "$(look "$T/has-key.sh")" = none ] || { echo "The cabinet has a key file. Stopping." >&2; exit 1; }

# A snapshot: version, release, config by hash, a real cart, and log sizes. Never the key.
cat > "$T/snap.sh" <<'EOF'
echo "version=$(cat /etc/arcade/provisioned-version)"
echo "commit=$(cat /etc/arcade/provisioned-commit 2>/dev/null)"
echo "current=$(readlink -f /opt/arcade/current)"
echo "releases=$(ls /opt/arcade/releases | wc -l)"
echo "config=$(sudo sha256sum /etc/arcade/service.json 2>/dev/null | cut -c1-16) $(sudo stat -c '%a %U' /etc/arcade/service.json 2>/dev/null)"
echo "serviceenv=$(cut -c1-60 /etc/arcade/service.env)"
echo "cart=$(sudo sha256sum /var/lib/arcade/carts/update-test-cart/game.js 2>/dev/null | cut -c1-16)"
echo "plays=$(sudo wc -l < /var/lib/arcade/logs/play.jsonl 2>/dev/null)"
echo "testlog=$(sudo sha256sum /var/lib/arcade/logs/update-test.log 2>/dev/null | cut -c1-16)"
echo "active=$(systemctl is-active arcade-launcher arcade-kiosk arcade-keyd | tr '\n' ' ')"
EOF
val() { echo "$1" | sed -n "s/^$2=//p"; }

# Set up: a fake key by the real path, and a cart and a log that aren't the seeded ones.
cat > "$T/setup.sh" <<'EOF'
sudo -u arcade mkdir -p /var/lib/arcade/carts/update-test-cart
sudo cp -R /var/lib/arcade/carts/apple-catch/. /var/lib/arcade/carts/update-test-cart/
sudo chown -R arcade:arcade /var/lib/arcade/carts/update-test-cart
echo 'stand-in log line' | sudo -u arcade tee /var/lib/arcade/logs/update-test.log >/dev/null
printf '%s' '{"anthropic_api_key":"sk-ant-api03-FAKEKEY1234567890","agent_id":"agent_TEST","agent_version":3,"environment_id":"env_TEST"}' | sudo node /opt/arcade/current/cabinet/vm/guest/service-config.mjs install
EOF
look "$T/setup.sh" | cut -c1-90
sleep 3
before="$(look "$T/snap.sh")"; echo "$before" | cut -c1-100

echo "=== an update with a changed bundle, over a live config"
echo "marker $(date -u +%s)" > "$MARK"
"$N" "$UP" --allow-dirty 2>&1 | cut -c1-110 | tail -18
after="$(look "$T/snap.sh")"; echo "$after" | cut -c1-100
result version-moved '[ "$(val "$after" version)" != "$(val "$before" version)" ] && [ -n "$(val "$after" version)" ]'
result commit-recorded 'val "$after" commit | grep -q "+dirty"'
result release-moved '[ "$(val "$after" current)" != "$(val "$before" current)" ]'
result old-release-kept '[ "$(val "$after" releases)" -gt "$(val "$before" releases)" ]'
result config-untouched '[ -n "$(val "$before" config)" ] && [ "$(val "$after" config)" = "$(val "$before" config)" ]'
result config-mode 'val "$after" config | grep -q " 600 arcade$"'
result still-live 'val "$after" serviceenv | grep -q -- "--config"'
result cart-kept '[ -n "$(val "$before" cart)" ] && [ "$(val "$after" cart)" = "$(val "$before" cart)" ]'
result log-kept '[ "$(val "$after" testlog)" = "$(val "$before" testlog)" ]'
result plays-kept '[ "$(val "$after" plays)" -ge "$(val "$before" plays)" ]'
result services-up 'val "$after" active | grep -q "^active active active"'
result key-check '"$D" run "$REPO/cabinet/vm/guest/key-check.sh" >/dev/null 2>&1'

echo "=== the same bundle again moves nothing"
out="$("$N" "$UP" --allow-dirty 2>&1)"; echo "$out" | tail -2 | cut -c1-90
again="$(look "$T/snap.sh")"
result idempotent '[ "$(val "$again" version)" = "$(val "$after" version)" ] && [ "$(val "$again" releases)" = "$(val "$after" releases)" ] && [ "$(val "$again" config)" = "$(val "$after" config)" ]'

echo "=== refused while a make runs"
cat > "$T/running.sh" <<'EOF'
echo '{}' | sudo -u arcade tee /var/lib/arcade/studio-run.json >/dev/null
EOF
look "$T/running.sh" >/dev/null
echo "marker $(date -u +%s) two" > "$MARK"
out="$("$N" "$UP" --allow-dirty 2>&1)"; rc=$?; echo "$out" | tail -1 | cut -c1-120
held="$(look "$T/snap.sh")"
result refused-while-making '[ "$rc" != 0 ] && echo "$out" | grep -q "make is running" && [ "$(val "$held" version)" = "$(val "$again" version)" ]'
cat > "$T/notrunning.sh" <<'EOF'
sudo rm -f /var/lib/arcade/studio-run.json
EOF
look "$T/notrunning.sh" >/dev/null

echo "=== clean up the fake key and test data; back to replay on the checkout's real bundle"
rm -f "$MARK"
cat > "$T/clean.sh" <<'EOF'
sudo rm -f /etc/arcade/service.json /var/lib/arcade/logs/update-test.log
sudo rm -rf /var/lib/arcade/carts/update-test-cart
printf 'ARCADE_SERVICE_ARGS=--replay %s\n' /opt/arcade/current/studio-kit/cli/fixtures/penguin-catch | sudo tee /etc/arcade/service.env >/dev/null
sudo systemctl restart arcade-launcher
EOF
look "$T/clean.sh" >/dev/null
echo "failures: $fails"
exit "$fails"

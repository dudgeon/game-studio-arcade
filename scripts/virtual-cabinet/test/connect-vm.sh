#!/bin/bash
# The part of the connect test that needs a real cabinet, run by hand (D155). connect.test.mjs covers
# the rest under `npm test`. Stand-ins for ant and the API, and a fake key: no Console, no spend.
#
#   scripts/virtual-cabinet/test/connect-vm.sh --yes-this-is-a-throwaway-vm
#
# It checks on the cabinet: the real sudo path, the file's owner and mode, the service restarting with
# --config, the key nowhere else on the disk or in the journal, and key-check.sh both ways.
#
# IT LEAVES A FAKE KEY ON THE CABINET, so rebuild afterwards (rebuild.sh removes it). It stops if the
# cabinet already has a key file, so it can't overwrite a real one.
set -u
[ "${1:-}" = "--yes-this-is-a-throwaway-vm" ] || { sed -n '2,11p' "$0" >&2; exit 2; }
command -v script >/dev/null || { echo "needs macOS's script(1)" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
D="$REPO/cabinet/vm/drive"
S="$REPO/scripts/virtual-cabinet/connect-cabinet.sh"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"
LOCKFILE="$REPO/studio-kit/managed-agent/claude-lock.arcade-virtual.json"
KEY=sk-ant-api03-FAKEKEY1234567890
T="$(mktemp -d)"
trap 'rm -rf "$T"; rm -f "$LOCKFILE"' EXIT

[ ! -e "$LOCKFILE" ] || { echo "$LOCKFILE exists: this cabinet may be live. Stopping." >&2; exit 1; }
if "$D" ssh 'sudo test -e /etc/arcade/service.json' 2>/dev/null; then echo "The cabinet has a key file. Stopping." >&2; exit 1; fi

mkdir -p "$T/bin"
cat > "$T/bin/ant" <<EOF
#!/bin/bash
cat > /dev/null
lock=""; prev=""
for a in "\$@"; do [ "\$prev" = --lock-file ] && lock="\$a"; prev="\$a"; done
case " \$* " in
  *" --yes "*) printf '{"version":1,"origin":{"workspace_id":"wrkspc_TESTCABINET"},"resources":{"./agents/studio.md":{"kind":"agent","id":"agent_TEST","version":"3"},"./environments/studio.yaml":{"kind":"environment","id":"env_TEST"}}}' > "\$lock" ;;
esac
EOF
cat > "$T/bin/curl" <<'EOF'
#!/bin/bash
cat > /dev/null
printf 'HTTP/2 200\r\nanthropic-workspace-id: wrkspc_TESTCABINET\r\n\r\n'
EOF
chmod +x "$T/bin/ant" "$T/bin/curl"

fails=0
result() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

out="$( ( sleep 6; printf '%s\n' "$KEY"; sleep 4; printf 'y\n'; sleep 10 ) | PATH="$T/bin:$PATH" script -q /dev/null "$S" 2>&1 | tr -d '\r')"
echo "$out" | tail -4 | cut -c1-110
result connected 'echo "$out" | grep -q "The cabinet is live"'
result not-on-screen '! echo "$out" | grep -q FAKEKEY'

cat > "$T/vm.sh" <<'EOF'
sudo stat -c '%a %U %G' /etc/arcade/service.json
cut -c1-100 /etc/arcade/service.env 2>/dev/null || sudo cut -c1-100 /etc/arcade/service.env
systemctl is-active arcade-launcher arcade-kiosk | tr '\n' ' '; echo
P="$(mktemp)"; printf '%s%s\n' 'FAKE' 'KEY' > "$P"
sudo grep -rl --exclude=service.json -f "$P" /etc/arcade /var/lib/arcade /home /tmp /var/log /opt/arcade/provision /boot/firmware/seed 2>/dev/null | grep -v "^$P" | sed 's/^/ELSEWHERE /'
sudo journalctl --no-pager -o cat | grep -c -f "$P" | sed 's/^/JOURNAL /'
rm -f "$P"
EOF
vm="$("$D" run "$T/vm.sh" 2>/dev/null)"; echo "$vm" | cut -c1-110
result mode-and-owner 'echo "$vm" | grep -q "^600 arcade arcade"'
result live-args 'echo "$vm" | grep -q -- "--config /etc/arcade/service.json"'
result service-up 'echo "$vm" | grep -q "^active active"'
result not-elsewhere '! echo "$vm" | grep -q ELSEWHERE'
result not-in-journal 'echo "$vm" | grep -q "^JOURNAL 0"'
result key-check-passes '"$D" run "$REPO/cabinet/vm/guest/key-check.sh" >/dev/null 2>&1'

cat > "$T/plant.sh" <<'EOF'
printf 'planted %s%s\n' 'sk-ant-' 'negative-test' | sudo tee /var/lib/arcade/logs/planted.log >/dev/null
EOF
"$D" run "$T/plant.sh" >/dev/null 2>&1
result key-check-catches-a-planted-key '! "$D" run "$REPO/cabinet/vm/guest/key-check.sh" >/dev/null 2>&1'

echo "failures: $fails. Now rebuild: this cabinet has a fake key and a planted file."
exit "$fails"

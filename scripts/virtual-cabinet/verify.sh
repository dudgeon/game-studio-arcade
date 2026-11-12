#!/bin/bash
# Checks a running virtual cabinet against V0's done-when, using only SSH and the
# driver. Screenshots go to OUTDIR. Exit 0 only if every check passes.
#
#   scripts/virtual-cabinet/verify.sh OUTDIR
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
OUT="${1:?usage: verify.sh OUTDIR}"
mkdir -p "$OUT"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"
D="$REPO/cabinet/vm/drive"
fails=0
check() {
  local name="$1"; shift
  if "$@" > "$OUT/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name (see $OUT/$name.log)"; fails=$((fails + 1)); fi
}
# These only look, so they can repeat while SSH itself is failing (exit 255, D156). Each try is limited.
export ARCADE_SSH_TIMEOUT_S="${ARCADE_SSH_TIMEOUT_S:-120}"
guest() {
  local rc i
  for i in $(seq 1 60); do
    "$D" ssh "$@"; rc=$?
    [ "$rc" = 255 ] || return "$rc"
    sleep 5
  done
  return 255
}
guest_run() {
  local rc i
  for i in $(seq 1 60); do
    "$D" run "$@"; rc=$?
    [ "$rc" = 255 ] || return "$rc"
    sleep 5
  done
  return 255
}

check services guest 'systemctl is-active arcade-launcher arcade-kiosk arcade-keyd nftables avahi-daemon'
check hostname guest 'test "$(hostname)" = arcade-virtual'
check screen-mode guest 'sudo runuser -u arcade -- env XDG_RUNTIME_DIR=/run/user/$(id -u arcade) WAYLAND_DISPLAY=wayland-0 wlr-randr | grep -E "1024x768.*current"'
check three-carts guest 'test "$(ls /var/lib/arcade/carts | wc -l)" -ge 3 && ls /var/lib/arcade/carts/apple-catch/game.js /var/lib/arcade/carts/comet-dodge/game.js /var/lib/arcade/carts/wall-ball/game.js'
check service-replying guest 'node -e "fetch(\"http://127.0.0.1:8330/api/config\").then(r=>process.exit(r.ok?0:1))"'
check devtools-local-only guest '! ss -ltn | grep ":9222" | grep -qv "127.0.0.1"'

check console-not-on-serial guest '! grep -q hvc /proc/consoles'
check swap-as-on-pi guest 'grep -q zram /proc/swaps'
check sound-out guest 'sudo runuser -u arcade -- aplay -l | grep -q virtio-snd && head -c 96000 /dev/zero | sudo runuser -u arcade -- aplay -q -D hw:0 -f S16_LE -r 48000 -c 2 -t raw -'
check no-failed-units guest 'test -z "$(systemctl --failed --no-legend --plain)" || { systemctl --failed --no-legend --plain; false; }'
# D244: nothing holds boot behind networkd's wait-online. Proven only by a boot since the fix: online within 30 s.
check boot-not-held guest 'test "$(systemctl is-enabled systemd-networkd-wait-online 2>&1)" = masked && t=$(systemctl show -p ActiveEnterTimestampMonotonic --value network-online.target) && echo "network-online at $((t / 1000000)) s" && test "$t" -gt 0 && test "$t" -lt 30000000'

check no-utm-window swift "$REPO/scripts/virtual-cabinet/windows.swift"

# Isolation (D123, D124).
check no-shared-folders guest '! grep -qE "virtiofs|9p" /proc/mounts'
check no-guest-tools guest '! dpkg -l spice-vdagent qemu-guest-agent 2>/dev/null | grep -q ^ii'
# The key lives in service.json and nowhere else (D131, D155). Run as a script file, for the quoting.
check key-only-in-its-file guest_run "$REPO/cabinet/vm/guest/key-check.sh"
check firewall-rule guest 'sudo nft list table inet arcade_isolation | grep -q reject'
mini_probe() {
  local addr addrs
  addrs="$(guest 'cat /etc/arcade/mini-addrs' | grep -v '^fe80')" || return 1
  [ -n "$addrs" ] || { echo "no mini addresses"; return 1; }
  for addr in $addrs; do
    # Refused straight away by our own rule, not by the mini. The counters prove which.
    guest "count() { sudo nft list table inet arcade_isolation | grep -o 'packets [0-9]*' | awk '{s+=\$2} END {print s+0}'; }; before=\$(count); ! timeout 5 bash -c 'exec 3<>/dev/tcp/$addr/22'; after=\$(count); echo $addr \$before '->' \$after; test \"\$after\" -gt \"\$before\"" || return 1
  done
}
check firewall-refuses-mini mini_probe
# The mini's private card (D241): the mini comes in by it, the cabinet can't go out by it.
link_probe() {
  guest 'ip -o -4 addr show | grep -q " 192\.168\.64\."' || { echo "no private card on this VM: skipped"; return 0; }
  guest '! ip -4 route show default | grep -q 192\.168\.64\.' || { echo "the private card has a default route"; return 1; }
  guest "count() { sudo nft list table inet arcade_isolation | grep -o 'packets [0-9]*' | awk '{s+=\$2} END {print s+0}'; }; before=\$(count); ! timeout 5 bash -c 'exec 3<>/dev/tcp/192.168.64.1/22'; after=\$(count); test \"\$after\" -gt \"\$before\""
}
check firewall-refuses-mini-on-link link_probe
# The network record (D242), kept across restarts.
# Enabled, and not held behind network-online, which waits 2 minutes and fails on every boot here.
check netwatch-starts-at-boot guest 'test "$(systemctl is-enabled arcade-netwatch)" = enabled && ! systemctl show -p After -p Wants -p Requires arcade-netwatch | grep -q network-online'
check netwatch-recording guest 'systemctl is-active --quiet arcade-netwatch && sudo journalctl -u arcade-netwatch -b --no-pager | grep -q "netwatch CHANGE"'
# D245: no false address conflicts from the bridge's MAC NAT, and the bridged card keeps its subnet route.
check bridged-subnet-route guest 'd=$(ip -4 route show default | awk "{print \$5; exit}") && ip -4 route show table main | grep " dev $d proto kernel scope link" && test "$(cat /etc/NetworkManager/conf.d/arcade-no-acd.conf)" = "$(printf "[connection-arcade-no-acd]\nipv4.dad-timeout=0")"'
check journal-on-disk guest'test -d /var/log/journal && journalctl --list-boots --no-pager | grep -q .'

# The screens: a cart from the shelf, by the real input path. Safe to repeat.
PLAY="$OUT/play"
rm -rf "$PLAY"
check play-flow /opt/homebrew/opt/node@22/bin/node "$REPO/cabinet/vm/flow.mjs" --script "$REPO/cabinet/vm/flows/play.drive" --out "$PLAY"
different() { [ -s "$1" ] && [ -s "$2" ] && ! cmp -s "$1" "$2"; }
check input-moved-selection different "$PLAY/01-shelf.png" "$PLAY/02-shelf-moved.png"
check game-started different "$PLAY/04-game-title.png" "$PLAY/05-game-playing.png"
check hold-changed-game different "$PLAY/05-game-playing.png" "$PLAY/06-game-after-hold.png"
check left-the-game different "$PLAY/06-game-after-hold.png" "$PLAY/07-left-the-game.png"
check play-logged-as-cabinet guest 'sudo grep -q "\"origin\":\"cabinet\"" /var/lib/arcade/logs/play.jsonl && ! sudo grep -q "\"origin\":\"desktop\"" /var/lib/arcade/logs/play.jsonl'
# Leave wherever the game left us, so the next run starts from the shelf.
"$D" press esc >/dev/null 2>&1 || true
sleep 1
"$D" press esc >/dev/null 2>&1 || true
sleep 1

# Frame time, labelled virtual (D128).
playtest_virtual() {
  local rc i
  for i in $(seq 1 60); do
    ARCADE_SSH_TIMEOUT_S=900 "$D" playtest > "$OUT/playtest-virtual.json" 2> "$OUT/playtest-virtual.err"; rc=$?
    [ "$rc" = 255 ] || return "$rc"
    sleep 5
  done
  return 255
}
if playtest_virtual; then
  echo "PASS playtest ($OUT/playtest-virtual.json)"
else
  echo "FAIL playtest (see $OUT/playtest-virtual.json)"; fails=$((fails + 1))
fi

guest 'sudo systemd-analyze 2>/dev/null; uname -a; cat /etc/os-release | head -3' > "$OUT/system.log" 2>&1 || true
echo "failures: $fails"
exit "$fails"

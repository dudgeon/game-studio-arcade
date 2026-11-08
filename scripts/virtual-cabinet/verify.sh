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
guest() { "$D" ssh "$@"; }

check services guest 'systemctl is-active arcade-launcher arcade-kiosk arcade-keyd nftables avahi-daemon'
check hostname guest 'test "$(hostname)" = arcade-virtual'
check screen-mode guest 'sudo runuser -u arcade -- env XDG_RUNTIME_DIR=/run/user/$(id -u arcade) WAYLAND_DISPLAY=wayland-0 wlr-randr | grep -E "1024x768.*current"'
check three-carts guest 'test "$(ls /var/lib/arcade/carts | wc -l)" -ge 3 && ls /var/lib/arcade/carts/collect/game.js /var/lib/arcade/carts/dodge/game.js /var/lib/arcade/carts/paddle/game.js'
check launcher-lists guest 'node -e "fetch(\"http://127.0.0.1:8330/\").then(r=>process.exit(r.ok?0:1))"'

check swap-as-on-pi guest 'grep -q zram /proc/swaps'
check sound-out guest 'sudo runuser -u arcade -- aplay -l | grep -q virtio-snd && head -c 96000 /dev/zero | sudo runuser -u arcade -- aplay -q -D hw:0 -f S16_LE -r 48000 -c 2 -t raw -'
# Pi OS enables networkd's wait-online too, but NetworkManager runs the network, so that unit always times out.
check no-failed-units guest 'test -z "$(systemctl --failed --no-legend --plain | grep -vE "systemd-networkd-wait-online" )" || { systemctl --failed --no-legend --plain; false; }'

# Isolation (D123, D124).
check no-shared-folders guest '! grep -qE "virtiofs|9p" /proc/mounts'
check no-guest-tools guest '! dpkg -l spice-vdagent qemu-guest-agent 2>/dev/null | grep -q ^ii'
check no-api-key guest '! sudo grep -rIlE "sk-ant-|ANTHROPIC_API_KEY" /etc/arcade /var/lib/arcade/carts /opt/arcade/current/cabinet'
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

# The screens, through the driver, by the real input path.
check shot-launcher "$D" screenshot "$OUT/launcher.png"
check press-down "$D" press down
sleep 1
check shot-launcher-moved "$D" screenshot "$OUT/launcher-moved.png"
different() { [ -s "$1" ] && [ -s "$2" ] && ! cmp -s "$1" "$2"; }
check input-moved-selection different "$OUT/launcher.png" "$OUT/launcher-moved.png"
check press-a "$D" press a
sleep 3
check shot-cart "$D" screenshot "$OUT/cart-running.png"
check cart-started different "$OUT/launcher-moved.png" "$OUT/cart-running.png"
# Past the title screen, so a held button acts on a game in play.
check press-start "$D" press start
sleep 1
check shot-playing "$D" screenshot "$OUT/cart-playing.png"
check game-started different "$OUT/cart-running.png" "$OUT/cart-playing.png"
check hold-button "$D" hold left 400
check shot-cart-after-hold "$D" screenshot "$OUT/cart-after-hold.png"
check hold-changed-game different "$OUT/cart-playing.png" "$OUT/cart-after-hold.png"
check back-to-shelf "$D" press esc
sleep 2
check shot-after-esc "$D" screenshot "$OUT/after-esc.png"
check left-the-game different "$OUT/cart-after-hold.png" "$OUT/after-esc.png"
check play-logged guest 'sudo test -s /var/lib/arcade/logs/play.jsonl'
# Leave the check screen, so the next run starts from the shelf.
"$D" press b >/dev/null 2>&1 || true
sleep 1

# Frame time, labelled virtual (D128).
if "$D" playtest > "$OUT/playtest-virtual.json" 2> "$OUT/playtest-virtual.err"; then
  echo "PASS playtest ($OUT/playtest-virtual.json)"
else
  echo "FAIL playtest (see $OUT/playtest-virtual.json)"; fails=$((fails + 1))
fi

guest 'sudo systemd-analyze 2>/dev/null; uname -a; cat /etc/os-release | head -3' > "$OUT/system.log" 2>&1 || true
echo "failures: $fails"
exit "$fails"

#!/bin/bash
# The power button (D372) on a QEMU copy of the card, by hand, after the first boot (as for update-rehearsal.sh):
#
#   scripts/cabinet-card/test/button-rehearsal.sh DIR
#
# The Picade's button is KEY_POWER on its gpio_keys device. Here a virtual device (uinput) presses KEY_POWER:
#   tap     0.3 s: nothing happens
#   qemu    QEMU's own power button (system_powerdown, the kernel's power key): nothing happens either
#   hold    2.5 s: the cabinet switches itself off cleanly (QEMU exits once the guest has powered off)
# Then it starts the VM again. What only the Picade can show (the HAT's 3 s hard cut against the shutdown) is C6.
set -u
[ -n "${1:-}" ] || { sed -n '2,11p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
fails=0
result() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
look() { local rc i; for i in $(seq 1 60); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 4; done; return 255; }
alive() { kill -0 "$(cat "$DIR/qemu.pid" 2>/dev/null)" 2>/dev/null; }
boot_id() { look 'cat /proc/sys/kernel/random/boot_id'; }

# A virtual power key, held for SECONDS: the same KEY_POWER events the Picade's overlay sends.
cat > "$DIR/press.py" <<'PY'
import fcntl, os, struct, sys, time
UI_SET_EVBIT, UI_SET_KEYBIT, UI_DEV_CREATE, UI_DEV_DESTROY = 0x40045564, 0x40045565, 0x5501, 0x5502
EV_SYN, EV_KEY, KEY_POWER = 0, 1, 116
fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
fcntl.ioctl(fd, UI_SET_KEYBIT, KEY_POWER)
os.write(fd, struct.pack("80sHHHHi", b"rehearsal-power-key", 3, 1, 1, 1, 0) + bytes(4 * 64 * 4))
fcntl.ioctl(fd, UI_DEV_CREATE)
time.sleep(3)  # arcade-powerkey looks for new devices every 2 s
def ev(t, c, v): os.write(fd, struct.pack("llHHi", 0, 0, t, c, v))
ev(EV_KEY, KEY_POWER, 1); ev(EV_SYN, 0, 0)
time.sleep(float(sys.argv[1]))
ev(EV_KEY, KEY_POWER, 0); ev(EV_SYN, 0, 0)
time.sleep(1)
fcntl.ioctl(fd, UI_DEV_DESTROY)
PY
"$D" ssh "sudo tee /opt/press.py >/dev/null" < "$DIR/press.py"

echo "=== the setup"
look 'systemctl is-active arcade-powerkey; systemd-analyze cat-config systemd/logind.conf | grep -E "^HandlePowerKey"' | tr '\n' ' '; echo
result logind-ignores 'look "systemd-analyze cat-config systemd/logind.conf" | grep -q "^HandlePowerKey=ignore"'
result watcher-running '[ "$(look "systemctl is-active arcade-powerkey")" = active ]'

echo "=== tap: nothing happens"
b="$(boot_id)"
look 'sudo modprobe uinput; sudo python3 /opt/press.py 0.3' >/dev/null
sleep 8
result tap-still-on 'alive && [ "$(boot_id)" = "$b" ] && [ "$(look "systemctl is-active arcade-launcher")" = active ]'
result tap-logged 'look "journalctl -u arcade-powerkey -b --no-pager" | grep -q "tap (0\.[0-9] s): ignored"'

echo "=== qemu: the kernel's own power key (system_powerdown): nothing happens either"
"$N" -e 'const s=require("net").connect(process.argv[1]);let n=0;s.on("data",d=>{for(const l of String(d).split("\n").filter(Boolean)){const j=JSON.parse(l);if(j.QMP||"return" in j){n++;if(n===1)s.write(JSON.stringify({execute:"qmp_capabilities"})+"\n");else if(n===2)s.write(JSON.stringify({execute:"system_powerdown"})+"\n");else s.end();}}})' "$DIR/qmp.sock"
sleep 15
result qemu-key-still-on 'alive && [ "$(boot_id)" = "$b" ]'

echo "=== hold 2.5 s: switches off cleanly"
look 'sudo python3 /opt/press.py 2.5' >/dev/null
for _ in $(seq 1 60); do alive || break; sleep 2; done
result hold-powered-off '! alive'
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null
look 'systemctl is-active arcade-launcher' >/dev/null
# Clean: the guest powered itself off (QEMU only exits then), and the root needed no journal replay at the next boot.
result hold-was-clean '! look "sudo dmesg" | grep -q "EXT4-fs (vda2): recovery complete"'
echo "failures: $fails"
exit "$fails"

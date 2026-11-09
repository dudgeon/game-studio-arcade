#!/bin/bash
# Soaks the bridged network (D156): what does the guest's own internet do while the mini can't reach it?
# The guest logs the router and api.anthropic.com to its boot partition (cabinet/vm/guest/netwatch.sh:
# free reachability only, no key). The mini probes the guest's SSH port every 5 s. Restarts the VM, never rebuilds.
#
#   scripts/virtual-cabinet/soak.sh OUTDIR [MIN_MINUTES] [MAX_MINUTES] [MINUTES_PER_BOOT]    default 60 180 45
#
# An outage lasting OUTAGE_S (600) ends that boot, so its log can be read: stop the VM, read the boot partition,
# start it again. It finishes once MIN_MINUTES have passed and an outage has been caught, or at MAX_MINUTES.
# It stops if the cabinet has a key file: someone is connecting it. It stops if a UTM window is on screen.
set -u
OUT="${1:?usage: soak.sh OUTDIR [MIN_MINUTES] [MAX_MINUTES] [MINUTES_PER_BOOT]}"
MIN_S=$(( ${2:-60} * 60 )); MAX_S=$(( ${3:-180} * 60 )); BOOT_S=$(( ${4:-45} * 60 ))
OUTAGE_S="${OUTAGE_S:-600}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
D="$REPO/cabinet/vm/drive"
U=/Applications/UTM.app/Contents/MacOS/utmctl
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
DISK="$VM_ROOT/arcade-virtual.utm/Data/disk.img"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"
HOST="${ARCADE_HOST:-arcade-virtual.local}"
mkdir -p "$OUT"
MINI="$OUT/mini.log"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$MINI"; }

state() { "$U" status arcade-virtual 2>/dev/null; }
windows_clear() { swift "$REPO/scripts/virtual-cabinet/windows.swift" >/dev/null 2>&1; }
ip_now() { dscacheutil -q host -a name "$HOST" 2>/dev/null | sed -n 's/^ip_address: //p' | head -1; }
reach() { local ip; ip="$(ip_now)"; [ -n "$ip" ] && /usr/bin/nc -z -G 3 "$ip" 22 >/dev/null 2>&1; }
key_file() { "$D" ssh 'sudo test -e /etc/arcade/service.json' >/dev/null 2>&1; }

# Stop the VM, keep this boot's guest log, and clear it from the boot partition's copy on the next start.
collect() {
  "$U" stop --request arcade-virtual >/dev/null 2>&1
  for _ in $(seq 1 12); do [ "$(state)" = started ] || break; sleep 5; done
  [ "$(state)" = started ] && "$U" stop arcade-virtual >/dev/null 2>&1
  sleep 3
  local plist m dev
  plist="$OUT/.attach.plist"
  hdiutil attach -imagekey diskimage-class=CRawDiskImage -nobrowse -readonly -mountrandom "$OUT" -plist "$DISK" 2>/dev/null > "$plist"
  m="$(sed -n 's|.*<string>\('"$OUT"'/dmg[^<]*\)</string>.*|\1|p' "$plist" | head -1)"
  dev="$(sed -n 's|.*<string>\(/dev/disk[0-9]*\)</string>.*|\1|p' "$plist" | head -1)"
  if [ -n "$m" ] && [ -f "$m/netwatch.log" ]; then cp "$m/netwatch.log" "$OUT/guest.log"; say "read the guest log: $(wc -l < "$OUT/guest.log" | tr -d ' ') lines"; else say "no guest log on the boot partition"; fi
  [ -n "$dev" ] && hdiutil detach "$dev" >/dev/null 2>&1
  rm -f "$plist"
}

start_vm() {
  "$U" start arcade-virtual >/dev/null 2>&1
  sleep 3
  windows_clear || { say "STOP: a UTM window is on screen"; exit 5; }
}

# Waits for the guest and starts its watcher. Returns 1 if the mini never reached it in 10 minutes.
begin_boot() {
  local until_t=$(( $(date +%s) + 600 ))
  while [ "$(date +%s)" -lt "$until_t" ]; do
    if "$D" run "$REPO/cabinet/vm/guest/netwatch.sh" 2>/dev/null | grep -q started; then say "watching this boot"; return 0; fi
    sleep 5
  done
  say "OUTAGE-FROM-BOOT: the mini never reached the guest in 10 minutes. Its watcher didn't start, so there's no guest log for this boot."
  return 1
}

[ "$(state)" = started ] || { say "the VM isn't running. Start it with scripts/virtual-cabinet/up.sh"; exit 1; }
if key_file; then say "STOP: the cabinet has a key file"; exit 3; fi

T0="$(date +%s)"
outages=0; caught=0; boots=0; ok=0; bad=0
say "soak: at least $((MIN_S / 60)) minutes, at most $((MAX_S / 60)), restart every $((BOOT_S / 60))"
begin_boot || { collect; start_vm; begin_boot || true; }
boots=1; boot_t="$(date +%s)"; down_since=0; last_key_check=0

while true; do
  now="$(date +%s)"
  [ "$now" -ge $((T0 + MAX_S)) ] && break
  [ "$now" -ge $((T0 + MIN_S)) ] && [ "$caught" -gt 0 ] && break

  if reach; then
    ok=$((ok + 1))
    if [ "$down_since" != 0 ]; then say "mini REACHES the guest again, after $((now - down_since)) s"; down_since=0; fi
    if [ $((now - last_key_check)) -ge 60 ]; then
      last_key_check="$now"
      if key_file; then say "STOP: the cabinet has a key file. Leaving the VM as it is."; exit 3; fi
    fi
  else
    bad=$((bad + 1))
    if [ "$down_since" = 0 ]; then down_since="$now"; outages=$((outages + 1)); say "mini CAN'T reach the guest (ip $(ip_now)), outage $outages"; fi
    if [ $((now - down_since)) -ge "$OUTAGE_S" ]; then
      caught=$((caught + 1))
      say "outage has lasted $OUTAGE_S s: restarting to read what the guest saw"
      collect
      cp "$OUT/guest.log" "$OUT/guest-outage-$caught.log" 2>/dev/null
      start_vm
      begin_boot
      boots=$((boots + 1)); boot_t="$(date +%s)"; down_since=0
      continue
    fi
  fi

  if [ "$now" -ge $((boot_t + BOOT_S)) ] && [ "$down_since" = 0 ]; then
    say "this boot has had $((BOOT_S / 60)) minutes: restarting for another (probes so far ok=$ok bad=$bad)"
    collect
    cp "$OUT/guest.log" "$OUT/guest-boot-$boots.log" 2>/dev/null
    start_vm
    begin_boot
    boots=$((boots + 1)); boot_t="$(date +%s)"
    continue
  fi
  sleep 5
done

say "finished: $(( ($(date +%s) - T0) / 60 )) minutes, $boots boots, probes ok=$ok bad=$bad, outages seen=$outages, long enough to read=$caught"
collect
cp "$OUT/guest.log" "$OUT/guest-final.log" 2>/dev/null
start_vm
begin_boot >/dev/null
# Leave the cabinet as it was found.
"$D" ssh 'sudo systemctl stop arcade-netwatch; sudo rm -f /boot/firmware/netwatch.log /tmp/arcade-netwatch.sh' >/dev/null 2>&1
windows_clear && say "0 UTM windows" || say "A UTM WINDOW IS ON SCREEN"

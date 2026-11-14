#!/bin/bash
# The Picade's network update, rehearsed on a QEMU copy of its card (D337). By hand, on the mini:
#
#   node scripts/cabinet-card/rehearse.mjs prepare DIR && node scripts/cabinet-card/rehearse.mjs start DIR
#   (wait for the first boot to reach the shelf, about 2 minutes)
#   scripts/cabinet-card/test/update-rehearsal.sh DIR
#
# REHEARSE_SSH_PORT as for rehearse.mjs. Never touches the virtual cabinet or the Picade. Each case:
#   busy        refused while a game is played, nothing changed
#   update      software and OS packages; data kept; boot packages held; guard installed
#   restart     the next boot checks the network after the OS packages changed, and keeps them
#   broken      a release whose service can't start, and a broken unit file: rolled back with its own provisioning
#   powercut    the power goes during an update: the next boot puts the cabinet back, data kept
#   broken-os   an OS package that breaks the service: put back as it was
#   no-network  an OS package that takes the network away: put back, network back
# It uses throwaway git worktrees of this checkout's HEAD for the broken and changed bundles: commit first.
set -u
[ -n "${1:-}" ] || { sed -n '2,20p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
WT="$DIR/worktrees"
LOG="$DIR/update-rehearsal.log"
fails=0
result() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
on() { "$D" ssh "$1" 2>/dev/null; }
# Retries while SSH itself fails (255), for after a restart.
look() { local rc i; for i in $(seq 1 60); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 5; done; return 255; }
update() { (cd "$1" && "$N" scripts/virtual-cabinet/update-cabinet.mjs --rehearsal "$DIR" --allow-dirty "${@:2}") >> "$LOG" 2>&1; }
snap() { look 'echo "version=$(cat /etc/arcade/provisioned-version)"; echo "data=$(sudo find /var/lib/arcade -path /var/lib/arcade/chromium -prune -o -path /var/lib/arcade/logs -prune -o -type f -print0 | sort -z | sudo xargs -0 sha256sum | sha256sum | cut -c1-16)"; echo "cart=$(sudo sha256sum /var/lib/arcade/carts/rehearsal-cart/game.js | cut -c1-16)"; echo "active=$(systemctl is-active arcade-launcher)"; echo "pending=$(sudo test -e /var/lib/arcade-update/pending && echo yes || echo no)"'; }
val() { echo "$1" | sed -n "s/^$2=//p"; }
last_result() { look 'sudo cat "$(ls -d /var/lib/arcade-update/*-*/ | tail -1)result.json"'; }
worktree() { # NAME: a fresh worktree of HEAD
  rm -rf "$WT/$1"; git -C "$REPO" worktree remove --force "$WT/$1" >/dev/null 2>&1
  git -C "$REPO" worktree add --detach "$WT/$1" HEAD >/dev/null 2>&1 && ln -s "$REPO/node_modules" "$WT/$1/node_modules"
}
cleanup() { for w in "$WT"/*; do [ -d "$w" ] && git -C "$REPO" worktree remove --force "$w" >/dev/null 2>&1; done; }
trap cleanup EXIT
mkdir -p "$WT"; : > "$LOG"
# Each prepare makes new host keys; drive keeps its own known_hosts for the rehearsal's address.
ssh-keygen -R "[127.0.0.1]:$REHEARSE_SSH_PORT" -f "$DIR/cabinet/ssh/known_hosts" >/dev/null 2>&1

echo "=== setup: a cart and a log of the family's that must come through every case"
look 'sudo -u arcade mkdir -p /var/lib/arcade/carts/rehearsal-cart && sudo cp -R /var/lib/arcade/carts/$(ls /var/lib/arcade/carts | grep -v rehearsal | head -1)/. /var/lib/arcade/carts/rehearsal-cart/ && sudo chown -R arcade:arcade /var/lib/arcade/carts/rehearsal-cart && echo kept | sudo -u arcade tee -a /var/lib/arcade/logs/rehearsal.log >/dev/null' >/dev/null
start="$(snap)"; echo "$start"

echo "=== busy: refused while a game is played"
on 'curl -s -X POST -H "Content-Type: application/json" -d "{\"playing\":true,\"what\":\"rehearsal-cart\"}" http://127.0.0.1:8330/api/arcade/playing' >/dev/null
update "$REPO"; rc=$?
busy="$(last_result)"
result busy-refused '[ "$rc" != 0 ] && echo "$busy" | grep -q "a game is being played"'
on 'curl -s -X POST -H "Content-Type: application/json" -d "{\"playing\":false}" http://127.0.0.1:8330/api/arcade/playing' >/dev/null
s="$(snap)"; result busy-nothing-changed '[ "$(val "$s" version)" = "$(val "$start" version)" ] && [ "$(val "$s" data)" = "$(val "$start" data)" ]'

echo "=== update: software and OS packages"
update "$REPO" --os; rc=$?
r="$(last_result)"
s="$(snap)"
result update-ok '[ "$rc" = 0 ] && echo "$r" | grep -q "\"ok\": true"'
result update-data-kept '[ "$(val "$s" data)" = "$(val "$start" data)" ] && [ "$(val "$s" cart)" = "$(val "$start" cart)" ]'
result boot-packages-held 'look "apt-mark showhold" | grep -q "^raspi-firmware$"'
result guard-installed 'look "systemctl is-enabled arcade-update-recover arcade-boot-confirm; systemctl is-enabled rpi-eeprom-update" | tr "\n" " " | grep -q "^enabled enabled masked"'

echo "=== restart: the network check after OS packages changed"
had_watch="$(look 'sudo test -e /var/lib/arcade-update/os-watch && echo yes || echo no')"
on 'sudo systemctl reboot'; sleep 20
look 'systemctl is-active arcade-launcher' >/dev/null; sleep 20
result restart-watch-cleared '[ "$(look "sudo test -e /var/lib/arcade-update/os-watch && echo yes || echo no")" = no ]'
echo "  (os-watch before the restart: $had_watch)"
s="$(snap)"; result restart-service-up '[ "$(val "$s" active)" = active ]'
good="$(val "$s" version)"

echo "=== broken: a release whose service can't start, and a broken unit file"
worktree broken
echo 'throw new Error("broken on purpose (D337)");' >> "$WT/broken/cabinet/service/bin/cabinet-service.js"
perl -0pi -e 's/^ExecStart=/ExecStartPre=\/bin\/false\nExecStart=/m' "$WT/broken/cabinet/provision/files/arcade-launcher.service"
update "$WT/broken"; rc=$?
r="$(last_result)"; s="$(snap)"
result broken-refused '[ "$rc" != 0 ] && echo "$r" | grep -q "\"rolled_back\": true"'
result broken-back-on-good '[ "$(val "$s" version)" = "$good" ] && [ "$(val "$s" active)" = active ]'
result broken-unit-restored '! look "grep -q /bin/false /etc/systemd/system/arcade-launcher.service"'
result broken-data-kept '[ "$(val "$s" data)" = "$(val "$start" data)" ]'

echo "=== powercut: the power goes during an update"
worktree changed
echo "// a harmless change, so the bundle is new (D337)" >> "$WT/changed/cabinet/service/bin/cabinet-service.js"
update "$WT/changed" &
up=$!
# Cut the power once provisioning is under way: npm ci is unpacking the new release.
for _ in $(seq 1 120); do
  on 'ls -d /opt/arcade/releases/*.tmp >/dev/null 2>&1 && echo cut' | grep -q cut && break
  sleep 1
done
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" stop "$DIR" >/dev/null
# The mini's side goes too, as if it had been asleep: its node first, or the subshell waits on it.
pkill -P "$up" 2>/dev/null; kill "$up" 2>/dev/null; wait "$up" 2>/dev/null
sleep 3
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null
look 'systemctl is-active arcade-launcher' >/dev/null
for _ in $(seq 1 60); do [ "$(look 'sudo test -e /var/lib/arcade-update/pending && echo yes || echo no')" = no ] && break; sleep 5; done
r="$(last_result)"; s="$(snap)"
result powercut-recovered 'echo "$r" | grep -q "\"recovered_at_boot\": true"'
result powercut-back-on-good '[ "$(val "$s" version)" = "$good" ] && [ "$(val "$s" active)" = active ] && [ "$(val "$s" pending)" = no ]'
result powercut-data-kept '[ "$(val "$s" data)" = "$(val "$start" data)" ]'
echo "  then the same update again, uninterrupted"
update "$WT/changed"; rc=$?
s="$(snap)"
result powercut-retry-ok '[ "$rc" = 0 ] && [ "$(val "$s" version)" != "$good" ] && [ "$(val "$s" data)" = "$(val "$start" data)" ]'
good="$(val "$s" version)"

echo "=== broken-os and no-network: OS packages from a local repository on the cabinet"
look 'set -e
sudo rm -rf /srv/rehearsal-repo /tmp/rpkg; sudo mkdir -p /srv/rehearsal-repo
mk() { # VERSION KIND
  d=/tmp/rpkg/$1; mkdir -p $d/DEBIAN $d/usr/share/doc/arcade-rehearsal
  printf "Package: arcade-rehearsal\nVersion: $1\nArchitecture: all\nMaintainer: rehearsal\nDescription: D337 rehearsal package\n" > $d/DEBIAN/control
  echo "$1" > $d/usr/share/doc/arcade-rehearsal/version
  case $2 in
    service) mkdir -p $d/etc/systemd/system/arcade-launcher.service.d; printf "[Service]\nExecStartPre=/bin/false\n" > $d/etc/systemd/system/arcade-launcher.service.d/zz-rehearsal.conf
      printf "#!/bin/sh\nsystemctl daemon-reload\n" > $d/DEBIAN/postinst; chmod 755 $d/DEBIAN/postinst ;;
    network) mkdir -p $d/etc/NetworkManager/conf.d; printf "[keyfile]\nunmanaged-devices=*\n" > $d/etc/NetworkManager/conf.d/zz-rehearsal.conf
      printf "#!/bin/sh\nsystemctl restart NetworkManager\nsleep 2\nip link set \$(ip -4 route show default | awk \"{ print \\\$5; exit }\") down\n" > $d/DEBIAN/postinst; chmod 755 $d/DEBIAN/postinst ;;
  esac
  dpkg-deb -b --root-owner-group $d /tmp/rpkg/arcade-rehearsal_$1_all.deb >/dev/null
}
mk 1.0 none; mk 2.0 service; mk 3.0 network
sudo dpkg -i /tmp/rpkg/arcade-rehearsal_1.0_all.deb >/dev/null
echo "deb [trusted=yes] file:/srv/rehearsal-repo ./" | sudo tee /etc/apt/sources.list.d/rehearsal.list >/dev/null' >/dev/null
publish() { look "sudo rm -f /srv/rehearsal-repo/*.deb; sudo cp /tmp/rpkg/arcade-rehearsal_$1_all.deb /srv/rehearsal-repo/; cd /srv/rehearsal-repo && sudo sh -c 'dpkg-scanpackages . /dev/null > Packages' 2>/dev/null" >/dev/null; }
pkg() { look 'dpkg-query -W -f="\${Version}" arcade-rehearsal'; }
publish 2.0
update "$REPO" --os; rc=$?
r="$(last_result)"; s="$(snap)"
result broken-os-refused '[ "$rc" != 0 ] && echo "$r" | grep -q "OS packages broke"'
result broken-os-put-back '[ "$(pkg)" = 1.0 ] && [ "$(val "$s" active)" = active ] && ! look "test -e /etc/systemd/system/arcade-launcher.service.d/zz-rehearsal.conf"'
# This checkout's software came with it and came up healthy, so it stays: only the OS packages go back.
result broken-os-software-stays 'echo "$r" | grep -q "\"version_after\": \"$(val "$s" version)\"" && [ "$(val "$s" active)" = active ] && [ "$(val "$s" data)" = "$(val "$start" data)" ]'
publish 3.0
update "$REPO" --os; rc=$?
sleep 30
r="$(last_result)"; s="$(snap)"
result no-network-refused '[ "$rc" != 0 ] && echo "$r" | grep -q "OS packages broke"'
result no-network-put-back '[ "$(pkg)" = 1.0 ] && [ "$(val "$s" active)" = active ]'
result no-network-reachable '[ -n "$(val "$s" version)" ]'
look 'sudo rm -f /etc/apt/sources.list.d/rehearsal.list; sudo dpkg -r arcade-rehearsal >/dev/null' >/dev/null

end="$(snap)"
result data-kept-throughout '[ "$(val "$end" data)" = "$(val "$start" data)" ] && [ "$(val "$end" cart)" = "$(val "$start" cart)" ]'
result log-kept 'look "sudo cat /var/lib/arcade/logs/rehearsal.log" | grep -q kept'
echo "failures: $fails (details: $LOG)"
exit "$fails"

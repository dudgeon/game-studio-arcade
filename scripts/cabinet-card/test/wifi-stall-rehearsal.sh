#!/bin/bash
# A Wi-Fi that says it's connected and carries nothing, and the cabinet's last-resort restart, rehearsed on the
# QEMU copy of the card (D510, D511). This is what happened to the Picade on 2026-11-14: from 17:31 its Wi-Fi
# stayed "connected" for three hours while the router got no answer from it. By hand, on the mini, after
# wifi-rehearsal.sh has set the same DIR up (its simulated radios and access points):
#
#   scripts/cabinet-card/test/wifi-stall-rehearsal.sh DIR
#
# The stall: an nftables rule on the access point's side drops every ARP from the cabinet's radio. The link stays
# associated, NetworkManager stays "connected", and the router never answers. The rule lives in memory, so a
# restart of the cabinet clears it, as a restart cleared the real one.
# For the rehearsal only, the watch runs with three settings (a drop-in, removed at the end): the cable the VM is
# always on is ignored, the restart comes after 120 s instead of 15 minutes, and "at most once an hour" is 30 minutes. The journal is made
# persistent too, as the card worker's hardening makes it on the Picade, so the line before a restart can be read after it.
# What it proves, each step PASS or FAIL:
#   stall     within 90 s the watch says the Wi-Fi is connected but the router doesn't answer, rejoins, and the
#             status the shelf reads says not connected
#   held      with a game being played the cabinet isn't restarted, and the journal says why
#   restart   once nobody is playing, the cabinet restarts itself; the journal, last-restart and restarts.log say
#             when and why; after the restart the Wi-Fi is back
#   hourly    the same stall again straight away does not restart it a second time inside the limit
# REHEARSE_SSH_PORT as usual. Never touches the virtual cabinet or the Picade.
set -u
[ -n "${1:-}" ] || { sed -n '2,22p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
OUT="$DIR/wifi-stall"
mkdir -p "$OUT"; : > "$OUT/steps.log"
fails=0
look() { local rc i out; for i in $(seq 1 90); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 4; done; return 255; }
step() { local res=PASS; [ "$2" = ok ] || { res=FAIL; fails=$((fails + 1)); }; echo "$res $1: $3" | tee -a "$OUT/steps.log" | cut -c1-400; }
# Waits up to $2 s for a journal line of the watch matching $1 in this boot; prints it.
journal() { local i l; for i in $(seq 1 $(( $2 / 5 ))); do l="$(look "journalctl -b -u arcade-wifi-watch --no-pager -o cat | grep -E '$1' | tail -1")"; [ -n "$l" ] && { echo "$l"; return 0; }; sleep 5; done; return 1; }
wifi_up() { local i; for i in $(seq 1 $(( $1 / 3 ))); do look "nmcli -t -f DEVICE,STATE device status | grep -q '^wlan0:connected' && sudo arping -q -c 1 -w 2 -I wlan0 \$(nmcli -g IP4.GATEWAY device show wlan0) && echo yes" | grep -q yes && return 0; sleep 3; done; return 1; }
STALL="sudo nft add table arp stall; sudo nft 'add chain arp stall in { type filter hook input priority 0; }'; sudo nft add rule arp stall in iifname wlan1 drop; sudo nft add rule arp stall in iifname wlan2 drop"

echo "=== setup: this branch's helper, the rehearsal's settings, a router that offers itself as the gateway"
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null 2>&1
look true >/dev/null
for f in src/wifi.js bin/arcade-wifi.js; do
  for _ in 1 2 3 4 5; do "$D" ssh "sudo tee /opt/arcade/current/cabinet/service/$f >/dev/null" < "$REPO/cabinet/service/$f" && break; sleep 5; done
done
[ "$(look "grep -c 'stallMisses' /opt/arcade/current/cabinet/service/src/wifi.js")" -ge 3 ] || { echo "couldn't put this branch's helper on the rehearsal cabinet"; exit 1; }
# The access points and the cabinet's radio are one machine here, and a kernel doesn't answer ARP that comes from
# one of its own addresses unless told to (accept_local, no reverse-path filter): in ap.sh, so it holds every boot.
look "sudo sed -i 's/--dhcp-option=3 /--dhcp-option=3,10.77.\$2.1 /' /opt/wifi-rehearsal/ap.sh; grep -c 'dhcp-option=3,10.77' /opt/wifi-rehearsal/ap.sh
grep -q accept_local /opt/wifi-rehearsal/ap.sh || echo 'for i in all wlan0 wlan1 wlan2; do /usr/sbin/sysctl -q -w net.ipv4.conf.\$i.accept_local=1 net.ipv4.conf.\$i.rp_filter=0; done' | sudo tee -a /opt/wifi-rehearsal/ap.sh >/dev/null
sudo install -d /etc/systemd/system/arcade-wifi-watch.service.d /var/log/journal /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\n' | sudo tee /etc/systemd/journald.conf.d/rehearsal.conf >/dev/null; sudo systemctl restart systemd-journald; sudo journalctl --flush
printf '[Service]\nEnvironment=ARCADE_WIFI_IGNORE_CABLE=1 ARCADE_WIFI_REBOOT_AFTER_S=120 ARCADE_WIFI_REBOOT_EVERY_S=1800\n' | sudo tee /etc/systemd/system/arcade-wifi-watch.service.d/rehearsal.conf >/dev/null
sudo rm -f /var/lib/arcade-wifi/last-restart /var/lib/arcade-wifi/restarts.log; sudo systemctl daemon-reload; sudo systemctl reboot" > "$OUT/setup.log" 2>&1
sleep 20
wifi_up 180 || { echo "the rehearsal cabinet isn't on its simulated Wi-Fi with a gateway: run wifi-rehearsal.sh on this DIR first"; exit 1; }
boot0="$(look 'cat /proc/sys/kernel/random/boot_id')"
echo "on Wi-Fi, gateway $(look 'nmcli -g IP4.GATEWAY device show wlan0'), boot $boot0"

echo "=== stall: the access points stop answering; the link stays up"
look "$STALL; nmcli -t -f DEVICE,STATE device status | grep '^wlan0'" | tail -1 > "$OUT/after-stall.txt"
l="$(journal "says connected .* but the router hasn.t answered" 90)" && step stall ok "the watch: $l" || step stall fail "no word from the watch within 90 s of the router going quiet"
l="$(journal "stalled [0-9]+ s: rejoin" 60)" && step stall ok "$l" || step stall fail "no rejoin"
st="$(look 'cat /run/arcade-wifi/status.json')"
case "$st" in *'"connected":false'*) step stall ok "the shelf's status says not connected, so the shelf says No Wi-Fi" ;; *) step stall fail "status: $st" ;; esac

echo "=== held: a game is being played"
look "nohup sh -c 'for i in \$(seq 1 70); do curl -s -X POST -H \"Content-Type: application/json\" -d \"{\\\"playing\\\":true,\\\"what\\\":\\\"teti\\\"}\" http://127.0.0.1:8330/api/arcade/playing >/dev/null; sleep 3; done' >/dev/null 2>&1 &" >/dev/null
l="$(journal "not restarting the cabinet: a game is being played" 240)" && step held ok "$l" || step held fail "no held line within 240 s"
[ "$(look 'cat /proc/sys/kernel/random/boot_id')" = "$boot0" ] && step held ok "still the same boot while the game is on" || step held fail "it restarted with a game being played"

echo "=== restart: nobody playing any more"
look "pkill -f 'api/arcade/playing' ; curl -s -X POST -H 'Content-Type: application/json' -d '{\"playing\":false}' http://127.0.0.1:8330/api/arcade/playing" >/dev/null
boot1="$boot0"
for _ in $(seq 1 60); do sleep 5; b="$(look 'cat /proc/sys/kernel/random/boot_id')"; [ -n "$b" ] && [ "$b" != "$boot0" ] && { boot1="$b"; break; }; done
[ "$boot1" != "$boot0" ] && step restart ok "the cabinet restarted itself" || step restart fail "no restart within 5 minutes of the game ending"
l="$(look "journalctl -b -1 -u arcade-wifi-watch --no-pager -o cat | grep 'restarting the cabinet as a last resort' | tail -1")"
[ -n "$l" ] && step restart ok "the journal of the boot before: $l" || step restart fail "no last-resort line in the previous boot's journal"
kept="$(look 'sudo cat /var/lib/arcade-wifi/last-restart; sudo sh -c "wc -l < /var/lib/arcade-wifi/restarts.log"')"
case "$kept" in *"no working Wi-Fi for"*"connected, but the router doesn't answer"*) step restart ok "kept: $(echo "$kept" | head -1)" ;; *) step restart fail "last-restart: $kept" ;; esac
wifi_up 120 && step restart ok "after the restart the Wi-Fi is back and the router answers" || step restart fail "no working Wi-Fi after the restart"

echo "=== hourly: the same stall again, straight away"
look "$STALL" >/dev/null
journal "says connected .* but the router hasn.t answered" 120 >/dev/null
sleep 200
[ "$(look 'cat /proc/sys/kernel/random/boot_id')" = "$boot1" ] && step hourly ok "stalled again for over 3 minutes (the limit here: 120 s to a restart, 30 minutes between restarts): no second restart" || step hourly fail "it restarted again inside the limit"
[ "$(look 'sudo sh -c "wc -l < /var/lib/arcade-wifi/restarts.log"')" = 1 ] && step hourly ok "restarts.log still holds one line" || step hourly fail "restarts.log: $(look 'sudo cat /var/lib/arcade-wifi/restarts.log')"

echo "=== tidy: the rehearsal's settings off"
look "sudo nft delete table arp stall; sudo rm -rf /etc/systemd/system/arcade-wifi-watch.service.d; sudo systemctl daemon-reload; sudo systemctl restart arcade-wifi-watch" >/dev/null
echo "failures: $fails (details: $OUT)"
exit "$fails"

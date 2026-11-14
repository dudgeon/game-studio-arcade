#!/bin/bash
# The cabinet's Wi-Fi against a real NetworkManager, rehearsed on a QEMU copy of the Picade's card (D418). The VM
# has no Wi-Fi chip, so the kernel's simulated radios (mac80211_hwsim) stand in: wlan0 is the cabinet's, and
# wlan1 and wlan2 are two access points (hostapd, with dnsmasq for addresses) that start at every boot, as a
# router is just there. By hand, on the mini, after rehearse.mjs prepare + start and the first boot:
#
#   scripts/cabinet-card/test/wifi-rehearsal.sh DIR [CUTS=10] [RESTARTS=5]
#
# What it proves, each step PASS or FAIL:
#   card      the first network arrives through netplan, as the card's does (D251), and provisioning's adopt keeps
#             it as a keyfile of ours (D410)
#   lost      netplan's copy is deleted, then our live keyfile too: the watch puts it back and Wi-Fi returns (D412)
#   radio     the radio is switched off, then blocked: the watch switches it back on
#   screen    as the kiosk's user, over the socket: a scan lists both networks; a wrong password fails and the
#             cabinet goes back; an awkward name and password join and are kept (D414)
#   cuts      CUTS power cuts (QEMU quits, nothing flushed), the first right after the join, and RESTARTS clean
#             restarts: Wi-Fi up within 60 s of power-on every time, with every saved network still there (D418)
# REHEARSE_SSH_PORT as usual. Never touches the virtual cabinet or the Picade.
set -u
[ -n "${1:-}" ] || { sed -n '2,20p' "$0" >&2; exit 2; }
DIR="$(cd "$1" && pwd)"
CUTS="${2:-10}"
RESTARTS="${3:-5}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
N=/opt/homebrew/opt/node@22/bin/node
export REHEARSE_SSH_PORT="${REHEARSE_SSH_PORT:-2299}"
export ARCADE_HOST=127.0.0.1 ARCADE_SSH_PORT="$REHEARSE_SSH_PORT" ARCADE_SSH_DIR="$DIR/cabinet/ssh" ARCADE_SSH_KEY_NAME=arcade_ed25519
D="$REPO/cabinet/vm/drive"
OUT="$DIR/wifi"
mkdir -p "$OUT"; : > "$OUT/steps.log"
HOME_SSID="Rehearsal Home"
HOME_PASS="correct horse 1"
GUEST_SSID="Rehearsal Guest; 2"
GUEST_PASS='two  spaces\and;semi"#x'
fails=0
look() { local rc i out; for i in $(seq 1 90); do out="$("$D" ssh "$1" 2>/dev/null)"; rc=$?; [ "$rc" = 255 ] || { echo "$out"; return "$rc"; }; sleep 4; done; return 255; }
step() { # NAME ok|fail DETAIL
  local res=PASS; [ "$2" = ok ] || { res=FAIL; fails=$((fails + 1)); }
  echo "$res $1: $3" | tee -a "$OUT/steps.log" | cut -c1-400
}
# Seconds until wlan0 is connected to $1 (any network if empty), or "no" after $2 seconds.
until_wifi() {
  local t0 i; t0=$(date +%s)
  for i in $(seq 1 $(( $2 / 2 ))); do
    look "nmcli -t -f DEVICE,STATE,CONNECTION device status | grep -q '^wlan0:connected:$1' && echo yes" | grep -q yes && { echo $(( $(date +%s) - t0 )); return 0; }
    sleep 2
  done
  echo no; return 1
}
ask() { # one request to the helper's socket, as the kiosk's user
  printf '%s' "$1" | "$D" ssh "cat > /tmp/wifi-req.json; sudo -u arcade /usr/local/bin/node -e '
const net = require(\"net\"), fs = require(\"fs\");
const s = net.connect(\"/run/arcade-wifi.sock\");
let out = \"\";
s.on(\"connect\", () => s.write(fs.readFileSync(\"/tmp/wifi-req.json\", \"utf8\").trim() + \"\\n\"));
s.on(\"data\", (d) => (out += d));
s.on(\"close\", () => console.log(out.trim()));
s.on(\"error\", (e) => console.log(JSON.stringify({ ok: false, why: String(e.message) })));
'; rm -f /tmp/wifi-req.json"
}
json() { "$N" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(String(eval(process.argv[1])))}catch(e){console.log("unreadable: "+s.slice(0,200))}})' "$1"; }

echo "=== setup: simulated radios and two access points that start at every boot"
"$D" ssh "sudo install -d /opt/wifi-rehearsal && sudo tee /opt/wifi-rehearsal/ap.sh >/dev/null && sudo chmod 755 /opt/wifi-rehearsal/ap.sh" <<AP
#!/bin/bash
# Two access points on simulated radios: the rehearsal's routers.
modprobe mac80211_hwsim radios=3
for i in \$(seq 1 50); do [ -e /sys/class/net/wlan2 ] && break; sleep 0.2; done
rfkill unblock all
ap() { # DEV NET SSID PASS
  printf 'interface=%s\ndriver=nl80211\nssid=%s\nhw_mode=g\nchannel=%s\nwpa=2\nwpa_key_mgmt=WPA-PSK\nrsn_pairwise=CCMP\nwpa_passphrase=%s\n' "\$1" "\$3" "\$5" "\$4" > "/run/ap-\$1.conf"
  ip addr flush dev "\$1"; ip addr add "10.77.\$2.1/24" dev "\$1"
  hostapd -B "/run/ap-\$1.conf"
  # Addresses only: no router and no DNS offered, so the VM's own network stays its way out.
  dnsmasq --interface="\$1" --bind-interfaces --except-interface=lo --port=0 --dhcp-range="10.77.\$2.50,10.77.\$2.150,1h" --dhcp-option=3 --dhcp-option=6 --pid-file="/run/dnsmasq-\$1.pid" --dhcp-leasefile="/run/dnsmasq-\$1.leases"
}
ap wlan1 1 '$HOME_SSID' '$HOME_PASS' 1
ap wlan2 2 '$GUEST_SSID' '$GUEST_PASS' 6
AP
look "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends hostapd dnsmasq-base >/dev/null 2>&1; sudo systemctl disable --now hostapd dnsmasq >/dev/null 2>&1
printf '[keyfile]\nunmanaged-devices=interface-name:wlan1;interface-name:wlan2\n' | sudo tee /etc/NetworkManager/conf.d/rehearsal-aps.conf >/dev/null
printf '[Unit]\nDescription=The rehearsal'\"'\"'s access points\nAfter=NetworkManager.service\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/opt/wifi-rehearsal/ap.sh\n[Install]\nWantedBy=multi-user.target\n' | sudo tee /etc/systemd/system/rehearsal-ap.service >/dev/null
sudo systemctl daemon-reload; sudo nmcli general reload conf; sudo systemctl enable --now rehearsal-ap.service >/dev/null 2>&1; sleep 3; nmcli -t -f DEVICE,TYPE,STATE device status | grep wlan | tr '\n' ' '" | tee "$OUT/setup.log"
grep -q "wlan0:wifi" "$OUT/setup.log" || { echo "no simulated Wi-Fi device: is mac80211_hwsim in this kernel?"; exit 1; }

echo "=== card: the first network through netplan, then adopted"
psk="$("$N" -e 'console.log(require("crypto").pbkdf2Sync(process.argv[1], process.argv[2], 4096, 32, "sha1").toString("hex"))' "$HOME_PASS" "$HOME_SSID")"
printf 'network:\n  version: 2\n  renderer: NetworkManager\n  wifis:\n    wlan0:\n      dhcp4: true\n      optional: true\n      regulatory-domain: "US"\n      access-points:\n        "%s":\n          password: "%s"\n' "$HOME_SSID" "$psk" > "$OUT/netplan.yaml"
# In place of the rehearsal card's own stand-in network, which names a network that isn't there.
"$D" ssh "sudo rm -f /etc/netplan/*.yaml; sudo tee /etc/netplan/50-cloud-init.yaml >/dev/null; sudo chmod 600 /etc/netplan/50-cloud-init.yaml; sudo netplan apply 2>&1 | grep -v 'too open' | grep -v '^\$'" < "$OUT/netplan.yaml"
t="$(until_wifi "netplan-wlan0-" 90)" && step card ok "joined through netplan in $t s" || step card fail "netplan's network didn't join"
home_id="arcade-wifi-$("$N" -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0, 12))' "$HOME_SSID")"
adopted="$(look "sudo /usr/local/bin/node /opt/arcade/current/cabinet/service/bin/arcade-wifi.js adopt 2>&1 | tail -1; sudo ls /var/lib/arcade-wifi /etc/NetworkManager/system-connections | grep -c $home_id; nmcli -t -f NAME,FILENAME connection show | grep -c '^$home_id:/etc/NetworkManager/system-connections/'")"
[ "$(echo "$adopted" | tail -2 | tr '\n' ' ')" = "2 1 " ] && step card ok "adopted: a keyfile in both places, and NetworkManager reads ours as it is" || step card fail "adopt: $adopted"
conf="$(look "sudo cat /etc/NetworkManager/conf.d/arcade-wifi.conf | grep -c -E 'autoconnect-retries-default=0|wifi.powersave=2'" )"
step card "$([ "$conf" = 2 ] && echo ok || echo fail)" "provisioning's NetworkManager settings on the cabinet: no power saving, retry for ever ($conf of 2 lines)"

echo "=== lost: netplan's copy goes, then our live keyfile goes"
look "sudo rm -f /etc/netplan/50-cloud-init.yaml /etc/netplan/90-NM-*.yaml; sudo netplan apply >/dev/null 2>&1; sudo nmcli connection reload" >/dev/null
t="$(until_wifi "arcade-wifi-" 90)" && step lost ok "with netplan's copy deleted, Wi-Fi is on our keyfile after $t s" || step lost fail "no Wi-Fi on our keyfile after netplan's copy went"
look "sudo rm -f /etc/NetworkManager/system-connections/arcade-wifi-*; sudo nmcli connection reload; sudo nmcli device disconnect wlan0 >/dev/null 2>&1" >/dev/null
t="$(until_wifi "arcade-wifi-" 120)" && step lost ok "with the live keyfile deleted and Wi-Fi dropped, the watch put it back: Wi-Fi after $t s" || step lost fail "the watch didn't bring Wi-Fi back after the keyfile was deleted"
look "sudo truncate -s 0 /etc/NetworkManager/system-connections/arcade-wifi-*; sleep 40; sudo sh -c 'wc -c < /etc/NetworkManager/system-connections/arcade-wifi-*'" | tail -1 | grep -qv '^0$' && step lost ok "a keyfile emptied (as a power cut can) is whole again within 40 s" || step lost fail "an emptied keyfile stayed empty"

echo "=== radio: switched off, then blocked"
look "sudo nmcli radio wifi off" >/dev/null
t="$(until_wifi "arcade-wifi-" 120)" && step radio ok "radio switched off: back on Wi-Fi after $t s" || step radio fail "the radio stayed off"
look "sudo rfkill block wifi" >/dev/null
t="$(until_wifi "arcade-wifi-" 120)" && step radio ok "radio blocked (rfkill): back on Wi-Fi after $t s" || step radio fail "the radio stayed blocked"

echo "=== screen: scan and join over the socket, as the kiosk's user"
scan="$(ask '{"op":"scan"}')"
echo "$scan" > "$OUT/scan.json"
[ "$(echo "$scan" | json 'o.networks.map(n=>n.ssid+"|"+n.kind+"|"+n.saved+"|"+n.inUse).sort().join(" ; ")')" = "$GUEST_SSID|psk|false|false ; $HOME_SSID|psk|true|true" ] && step screen ok "the scan lists both networks, the one in use marked and saved" || step screen fail "scan: $(echo "$scan" | cut -c1-300)"
kept_before="$(look "sudo ls /var/lib/arcade-wifi | grep -c arcade-wifi-")"
bad="$(ask "$("$N" -e 'console.log(JSON.stringify({op:"join",ssid:process.argv[1],password:"definitely wrong",security:"WPA2"}))' "$GUEST_SSID")")"
[ "$(echo "$bad" | json 'o.ok+"|"+o.back')" = "false|$HOME_SSID" ] && step screen ok "a wrong password fails ($(echo "$bad" | json o.why)) and the cabinet is back on $HOME_SSID" || step screen fail "wrong password: $bad"
[ "$(look "sudo ls /var/lib/arcade-wifi | grep -c arcade-wifi-")" = "$kept_before" ] && step screen ok "the failed network wasn't kept" || step screen fail "a failed join left a file"
good="$(ask "$("$N" -e 'console.log(JSON.stringify({op:"join",ssid:process.argv[1],password:process.argv[2],security:"WPA2"}))' "$GUEST_SSID" "$GUEST_PASS")")"
[ "$(echo "$good" | json 'o.ok+"|"+o.ssid+"|"+/^10\.77\.2\./.test(o.address)')" = "true|$GUEST_SSID|true" ] && step screen ok "an awkward name and password join: $(echo "$good" | json 'o.ssid+" at "+o.address+", signal "+o.signal')" || step screen fail "join: $good"

echo "=== cuts: the first one right after that join, with nothing flushed"
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" stop "$DIR" >/dev/null 2>&1
export LIMIT=60 OUT_LOG="$OUT/boots.log"; : > "$OUT_LOG"
boot_check() { # WHAT
  local line saved
  line="$(OUT="$OUT_LOG" "$REPO/scripts/cabinet-card/wifi-proof.sh" now 2>/dev/null | head -1)"
  for _ in $(seq 1 40); do case "$line" in *"Wi-Fi up none"*|*"doesn't answer"*|"") sleep 3; line="$(OUT="$OUT_LOG" "$REPO/scripts/cabinet-card/wifi-proof.sh" now 2>/dev/null | head -1)" ;; *) break ;; esac; done
  saved="$(look "sudo /usr/local/bin/node /opt/arcade/current/cabinet/service/bin/arcade-wifi.js status" | json 'o.saved.filter(s=>s.startsWith("Rehearsal ")&&s!=="Rehearsal network").sort().join(" ; ")')"
  if [ "${line%% *}" = PASS ] && [ "$saved" = "$GUEST_SSID ; $HOME_SSID" ]; then step "$1" ok "${line#PASS this boot 1: }; saved: $saved"; else step "$1" fail "${line:-no answer}; saved: $saved"; fi
}
for i in $(seq 1 "$CUTS"); do
  sleep 2
  "$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null
  boot_check "cut $i"
  # Later cuts land at a random moment in the first minute or so of a boot.
  sleep $(( RANDOM % 45 ))
  "$N" "$REPO/scripts/cabinet-card/rehearse.mjs" stop "$DIR" >/dev/null 2>&1
done
sleep 2
"$N" "$REPO/scripts/cabinet-card/rehearse.mjs" start "$DIR" >/dev/null
boot_check "after the last cut"
for i in $(seq 1 "$RESTARTS"); do
  before="$(look 'cat /proc/sys/kernel/random/boot_id')"
  "$D" ssh "sudo systemctl reboot" >/dev/null 2>&1
  for _ in $(seq 1 60); do sleep 3; now="$(look 'cat /proc/sys/kernel/random/boot_id')"; [ -n "$now" ] && [ "$now" != "$before" ] && break; done
  boot_check "restart $i"
done
echo "failures: $fails (details: $OUT)"
exit "$fails"

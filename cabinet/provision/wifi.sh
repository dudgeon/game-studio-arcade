# The cabinet's Wi-Fi, made to last (D410-D416). Sourced by provision.sh, so every first boot and every update
# runs it; a cabinet flashed before this existed gets it at its next update. Safe to run again.
#
#   /etc/NetworkManager/conf.d/arcade-wifi.conf   no Wi-Fi power saving; a network is retried for ever (D411)
#   /etc/arcade/wifi-country                      the Wi-Fi country, for the watch to set again if the radio forgets
#   arcade-wifi-watch.service                     puts back lost networks and brings a lost Wi-Fi back (D412)
#   arcade-wifi.socket, arcade-wifi@.service      scan and join for the launcher's Wi-Fi screens (D414): the
#                                                 kiosk's user has no sudo, so it asks root over a socket
#   the card's network, kept as one of ours       /var/lib/arcade-wifi, written whole and flushed (D410)
# Every file goes through put_file (update-lib.sh): flushed before it's renamed, so a power cut can't empty it.

nm_wifi_conf() {
  cat <<'CONF'
# Written by the arcade provisioning script (D411).
# A network that fails is tried again for ever, not 4 times: after a power cut the router may take minutes.
[main]
autoconnect-retries-default=0

# 2 is "off": the Pi's Wi-Fi chip otherwise sleeps between packets, and the mini loses the cabinet.
[connection-arcade-wifi]
wifi.powersave=2
CONF
}

wifi_watch_unit() {
  cat <<'UNIT'
[Unit]
Description=Keep the cabinet on its Wi-Fi: put back lost networks, bring a lost Wi-Fi back (D412)
After=NetworkManager.service

[Service]
ExecStart=/usr/local/bin/node /opt/arcade/current/cabinet/service/bin/arcade-wifi.js watch
RuntimeDirectory=arcade-wifi
RuntimeDirectoryMode=0755
Restart=always
RestartSec=10
Nice=5

[Install]
WantedBy=multi-user.target
UNIT
}

wifi_socket_unit() {
  cat <<'UNIT'
[Unit]
Description=The cabinet service's way to ask for a Wi-Fi scan or join (D414)

[Socket]
ListenStream=/run/arcade-wifi.sock
SocketUser=root
SocketGroup=arcade
SocketMode=0660
Accept=yes
MaxConnections=4

[Install]
WantedBy=sockets.target
UNIT
}

wifi_serve_unit() {
  cat <<'UNIT'
[Unit]
Description=One Wi-Fi request from the cabinet service (D414)

[Service]
ExecStart=/usr/local/bin/node /opt/arcade/current/cabinet/service/bin/arcade-wifi.js serve
StandardInput=socket
StandardOutput=socket
StandardError=journal
TimeoutStartSec=3min
UNIT
}

# The country the card was written with (D251): netplan's regulatory-domain, or the kernel's command line.
wifi_country() {
  local c
  c="$(sed -n 's/.*regulatory-domain: *"\{0,1\}\([A-Z][A-Z]\)"\{0,1\}.*/\1/p' /etc/netplan/*.yaml 2>/dev/null | head -1)"
  # NetworkManager's rewrite of the YAML can drop the country (seen in the rehearsal): the command line has it too.
  [ -n "$c" ] || c="$(sed -n 's/.*cfg80211\.ieee80211_regdom=\([A-Z][A-Z]\).*/\1/p' /proc/cmdline /boot/firmware/cmdline.txt 2>/dev/null | head -1)"
  echo "$c"
}

step_wifi() {
  # shellcheck source=update-lib.sh
  . "$SELF_DIR/update-lib.sh"
  local tmp country
  tmp="$(mktemp -d)"
  nm_wifi_conf > "$tmp/conf"
  put_file "$tmp/conf" /etc/NetworkManager/conf.d/arcade-wifi.conf 0644
  country="$(wifi_country)"
  if [ -n "$country" ]; then
    echo "$country" > "$tmp/country"
    put_file "$tmp/country" /etc/arcade/wifi-country 0644
  fi
  install -d -m 0700 /var/lib/arcade-wifi
  wifi_watch_unit > "$tmp/watch"
  wifi_socket_unit > "$tmp/socket"
  wifi_serve_unit > "$tmp/serve"
  put_file "$tmp/watch" /etc/systemd/system/arcade-wifi-watch.service 0644
  put_file "$tmp/socket" /etc/systemd/system/arcade-wifi.socket 0644
  put_file "$tmp/serve" /etc/systemd/system/arcade-wifi@.service 0644
  rm -rf "$tmp"
  systemctl daemon-reload
  nmcli general reload conf 2>/dev/null || true
  # The card's network becomes one of ours, flushed to disk, before anything else can lose it.
  /usr/local/bin/node "$ARCADE_HOME/current/cabinet/service/bin/arcade-wifi.js" adopt || log "couldn't keep the card's Wi-Fi network yet; the next update tries again"
  # The Wi-Fi it's on takes the new settings now (a reapply keeps the lease); otherwise at the next join.
  local dev
  dev="$(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | sed -n 's/^\([^:]*\):wifi:connected.*/\1/p' | head -1)"
  [ -z "$dev" ] || nmcli device reapply "$dev" >/dev/null 2>&1 || true
  systemctl enable arcade-wifi-watch.service arcade-wifi.socket >/dev/null 2>&1
  systemctl restart arcade-wifi.socket
  systemctl restart --no-block arcade-wifi-watch.service
  sync
}

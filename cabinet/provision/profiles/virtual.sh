# Hardware layer for the virtual cabinet (D122). Sourced by provision.sh.
HOSTNAME_WANTED=arcade-virtual

hw_early() {
  # The generator grew the partition in the disk's table; this grows the filesystem. Safe to repeat.
  resize2fs /dev/vda2 || true
  # No EEPROM here. Swap stays as on the Pi, and only needs the module Debian's kernel doesn't build in.
  systemctl mask rpi-eeprom-update.service
  printf 'loop\nuinput\n' > /etc/modules-load.d/arcade-virtual.conf
  modprobe loop
  modprobe uinput
}

hw_late() {
  step_journal
  step_mini_link
  step_no_acd
  step_firewall
  step_keys
  step_netwatch
}

# D242: keep the journal across restarts, so a lost network leaves its evidence. Capped, and only here:
# the Picade's SD card keeps the default.
step_journal() {
  install -d /etc/systemd/journald.conf.d
  printf '[Journal]\nStorage=persistent\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/arcade-virtual.conf
  install -d /var/log/journal
  systemd-tmpfiles --create --prefix /var/log/journal
  systemctl restart systemd-journald
  journalctl --flush || true
}

# D241: the second network card is the mini's own way in, on the Mac's private shared network. It never
# carries the cabinet's traffic: no default route, no DNS from it, no IPv6. The bridged card stays the
# cabinet's network (D152). Matched by its fixed MAC, so nothing here applies until the card exists.
MINI_LINK_MAC=5A:47:41:43:41:43
# The shared network macOS gives its VMs unless told otherwise; the mini is .1 on it.
LINK_NET=192.168.64.0/24
mini_link_keyfile() {
  cat <<NM
[connection]
id=arcade-mini-link
type=ethernet
autoconnect-priority=10

[ethernet]
mac-address=$MINI_LINK_MAC

[ipv4]
method=auto
never-default=true
ignore-auto-dns=true
ignore-auto-routes=true

[ipv6]
method=disabled
NM
}
step_mini_link() {
  local f=/etc/NetworkManager/system-connections/arcade-mini-link.nmconnection
  install -d -m 0700 /etc/NetworkManager/system-connections
  mini_link_keyfile > "$f"
  chmod 0600 "$f"
  nmcli connection reload || true
}

# D245: no address-conflict detection here. Bridged on Wi-Fi, macOS's MAC NAT puts the mini's own MAC on ARP
# for the cabinet's address, which is expected, not a conflict. On 2026-11-11 NetworkManager took one for a
# conflict and the cabinet lost its subnet route. Only the virtual profile: on the Picade a conflict is real.
nm_no_acd_conf() {
  printf '[connection-arcade-no-acd]\nipv4.dad-timeout=0\n'
}
step_no_acd() {
  local f=/etc/NetworkManager/conf.d/arcade-no-acd.conf dev changed=no
  install -d /etc/NetworkManager/conf.d
  if [ "$(cat "$f" 2>/dev/null)" != "$(nm_no_acd_conf)" ]; then nm_no_acd_conf > "$f"; changed=yes; fi
  nmcli general reload conf || true
  # The bridged card takes the new default, and a subnet route lost to a past false conflict comes back,
  # with a reapply, which keeps the lease. Otherwise both happen at the next boot.
  dev="$(ip -4 route show default | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
  [ -n "$dev" ] || return 0
  if [ "$changed" = yes ] || ! ip -4 route show table main | grep -q " dev $dev proto kernel scope link"; then
    log "reapplying $dev (no address-conflict detection; subnet route)"
    nmcli device reapply "$dev" || log "reapply didn't take: it applies at the next boot"
  fi
}

# D242: the cabinet's own record of its network paths.
step_netwatch() {
  install -m 0755 "$SELF_DIR/files/arcade-netwatch" /usr/local/bin/arcade-netwatch
  install -m 0644 "$SELF_DIR/files/arcade-netwatch.service" /etc/systemd/system/arcade-netwatch.service
  systemctl daemon-reload
  systemctl enable arcade-netwatch
  systemctl restart arcade-netwatch
}

# D124: refuse new connections to the mini; replies to its own requests still flow.
# The mini's addresses come from the seed, because the VM must not ask the mini for them.
step_firewall() {
  local v4="" v6=""
  if [ -f "$PAYLOAD/mini-addrs" ]; then
    install -d /etc/arcade
    install -m 0644 "$PAYLOAD/mini-addrs" /etc/arcade/mini-addrs
  fi
  if [ -f /etc/arcade/mini-addrs ]; then
    v4="$(grep -E '^[0-9.]+$' /etc/arcade/mini-addrs | paste -sd, - || true)"
    v6="$(grep ':' /etc/arcade/mini-addrs | paste -sd, - || true)"
  fi
  firewall_rules "$v4" "$v6" > /etc/nftables.conf
  systemctl enable nftables
  systemctl restart nftables
}

# The ruleset, for the mini's IPv4 and IPv6 addresses (comma-separated; either may be empty).
firewall_rules() {
  local v4="$1" v6="$2"
  {
    echo '#!/usr/sbin/nft -f'
    echo 'table inet arcade_isolation'
    echo 'delete table inet arcade_isolation'
    echo 'table inet arcade_isolation {'
    echo '  chain out {'
    echo '    type filter hook output priority 0; policy accept;'
    # The shared network (D241, and D124's fallback): the mini connects in; the cabinet doesn't connect out,
    # apart from DHCP, mDNS, and DNS, which only a shared-only VM uses (Both ignores the link's DNS).
    echo "    ip daddr $LINK_NET udp dport { 53, 67, 5353 } accept"
    echo "    ip daddr $LINK_NET tcp dport 53 accept"
    echo "    ip daddr $LINK_NET ct state new counter reject"
    if [ -n "$v4" ]; then
      # Shared networking's gateway is the mini too, and DNS has to reach it there.
      echo "    ip daddr { $v4 } udp dport { 53, 67, 5353 } accept"
      echo "    ip daddr { $v4 } tcp dport 53 accept"
      echo "    ip daddr { $v4 } ct state new counter reject"
    fi
    if [ -n "$v6" ]; then
      echo "    ip6 daddr { $v6 } udp dport { 53, 547, 5353 } accept"
      echo "    ip6 daddr { $v6 } tcp dport 53 accept"
      echo "    ip6 daddr { $v6 } ct state new counter reject"
    fi
    echo '  }'
    echo '}'
  }
}

# D144: the driver's keys go in through uinput, the way the Picade overlay's do.
step_keys() {
  install -m 0755 "$SELF_DIR/files/arcade-keyd" /usr/local/bin/arcade-keyd
  install -m 0644 "$SELF_DIR/files/arcade-keyd.service" /etc/systemd/system/arcade-keyd.service
  systemctl daemon-reload
  systemctl enable arcade-keyd
  systemctl restart arcade-keyd
}

# No API key on this cabinet yet: replay a recorded make, which spends nothing (D186).
service_args_without_key() {
  echo "--replay $ARCADE_HOME/current/studio-kit/cli/fixtures/penguin-catch"
}

kiosk_env() {
  cat <<'ENV'
WLR_BACKENDS=headless,libinput
WLR_RENDERER=pixman
WLR_HEADLESS_OUTPUTS=1
WLR_LIBINPUT_NO_DEVICES=1
ARCADE_OUTPUT=HEADLESS-1
CHROMIUM_EXTRA=--disable-gpu --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
ENV
}

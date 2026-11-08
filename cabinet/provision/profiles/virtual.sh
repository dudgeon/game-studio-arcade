# Hardware layer for the virtual cabinet (D122). Sourced by provision.sh.
HOSTNAME_WANTED=arcade-virtual

hw_early() {
  # The generator grew the partition in the disk's table; this grows the filesystem. Safe to repeat.
  resize2fs /dev/vda2 || true
}

hw_late() {
  step_firewall
  step_keys
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
  {
    echo '#!/usr/sbin/nft -f'
    echo 'table inet arcade_isolation'
    echo 'delete table inet arcade_isolation'
    echo 'table inet arcade_isolation {'
    echo '  chain out {'
    echo '    type filter hook output priority 0; policy accept;'
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
  } > /etc/nftables.conf
  systemctl enable nftables
  systemctl restart nftables
}

# D144: the driver's keys go in through uinput, the way the Picade overlay's do.
step_keys() {
  install -m 0755 "$SELF_DIR/files/arcade-keyd" /usr/local/bin/arcade-keyd
  install -m 0644 "$SELF_DIR/files/arcade-keyd.service" /etc/systemd/system/arcade-keyd.service
  echo uinput > /etc/modules-load.d/arcade-uinput.conf
  systemctl daemon-reload
  systemctl enable arcade-keyd
  systemctl restart arcade-keyd
}

kiosk_env() {
  cat <<'ENV'
WLR_BACKENDS=headless,libinput
WLR_RENDERER=pixman
WLR_HEADLESS_OUTPUTS=1
WLR_LIBINPUT_NO_DEVICES=1
ARCADE_OUTPUT=HEADLESS-1
CHROMIUM_EXTRA=--disable-gpu
ENV
}

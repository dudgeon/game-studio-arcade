# Sourced by the picade profile (D395): the Picade's own hardening, from its first lost Wi-Fi (2026-11-14), when the
# failing boots left no evidence and the card is hard to reach once the cabinet is assembled. Safe to run again.
# The Wi-Fi itself (keyfiles, power saving, the watch, the Wi-Fi screens) is cabinet/provision/wifi.sh (D410-D415).
# ETC is for the test.
HARDEN_ETC="${HARDEN_ETC:-/etc}"

# A persistent journal, capped, so the next drop leaves evidence. Pi OS keeps it in memory only
# (40-rpi-volatile-storage.conf); a higher-numbered drop-in wins.
journal_conf() { printf '[Journal]\nStorage=persistent\nSystemMaxUse=50M\n'; }
step_journal_persistent() {
  local f="$HARDEN_ETC/systemd/journald.conf.d/90-arcade-persistent.conf"
  install -d "$(dirname "$f")"
  if [ "$(cat "$f" 2>/dev/null)" != "$(journal_conf)" ]; then
    journal_conf > "$f"
    if [ -z "${HARDEN_TEST:-}" ]; then
      install -d /var/log/journal
      systemd-tmpfiles --create --prefix /var/log/journal 2>/dev/null || true
      systemctl restart systemd-journald
      journalctl --flush 2>/dev/null || true
    fi
    log "journal: persistent, at most 50 MB (D395)"
  fi
}

# cloud-init only had first boot to do. Off from then on, so nothing re-renders the network, and the card's bootcmd
# (do_wifi_country, which rewrites cmdline.txt on FAT) never runs again.
step_cloud_init_off() {
  local f="$HARDEN_ETC/cloud/cloud-init.disabled"
  [ -e "$f" ] && return 0
  install -d "$(dirname "$f")"
  printf 'Disabled by the arcade provisioning after first boot (D395).\n' > "$f"
  log "cloud-init: off after first boot (D395)"
}

# D396: the USB-C service port. Raspberry Pi's own rpi-usb-gadget (in the image) makes the Pi 5's USB-C a USB Ethernet
# gadget: g_ether, dwc2 in peripheral mode, and NetworkManager profiles that serve the mini an address on
# 10.12.194.0/28 (the Pi is 10.12.194.1), or take one if the mini shares its internet. Its overlay line belongs in our
# config.txt block (picade.sh config_block); the copy it appends after the block is removed. ⚠ The USB-C port is also
# the Pi's power input: a cable from the mini must go through a VBUS (power) blocker, as the X HAT already powers it.
step_usb_gadget() {
  local cfg="${CONFIG_TXT:-/boot/firmware/config.txt}" line="dtoverlay=dwc2,dr_mode=peripheral"
  command -v rpi-usb-gadget >/dev/null 2>&1 || { log "usb gadget: rpi-usb-gadget isn't installed; skipped"; return 0; }
  if [ ! -f /etc/modules-load.d/usb-gadget.conf ] || ! nmcli -t -f NAME con show 2>/dev/null | grep -q '^USB Gadget (shared)$'; then
    rpi-usb-gadget on >/dev/null 2>&1 || { log "usb gadget: rpi-usb-gadget on failed"; return 0; }
    log "usb gadget: on (D396); the USB-C port is a network port from the next boot"
  fi
  dedupe_gadget_overlay "$cfg"
  sync
}

# The overlay line only inside our block: rpi-usb-gadget appends its own copy at the end of config.txt.
dedupe_gadget_overlay() {
  local cfg="$1" line="dtoverlay=dwc2,dr_mode=peripheral"
  awk -v l="$line" '/^# BEGIN arcade provision$/ { b = 1 } /^# END arcade provision$/ { print; b = 0; next } b || $0 != l { print }' "$cfg" > "$cfg.new" && cat "$cfg.new" > "$cfg" && rm -f "$cfg.new"
}

# D397: Tailscale, so the mini reaches the cabinet from anywhere (Geoff, 2026-11-14), from Tailscale's own apt
# repository, its key checked by fingerprint, the version pinned in lock.json. tailscaled runs; the one sign-in is a
# person's (docs/flash-day.md): tailscale up --hostname=arcade --ssh=false --accept-dns=false. We use our own SSH key over
# the tailnet, never Tailscale SSH; MagicDNS stays off so the cabinet's own lookups never depend on it.
TAILSCALE_KEY_FPR=2596A99EAAB33821893C0A79458CA832957F5868
step_tailscale() {
  local version keyring=/usr/share/keyrings/tailscale-archive-keyring.gpg list=/etc/apt/sources.list.d/tailscale.list fpr
  version="$(sed -n 's/.*"tailscale_version": *"\([^"]*\)".*/\1/p' "$SELF_DIR/lock.json")"
  [ -n "$version" ] || { log "tailscale: no version in lock.json; skipped"; return 0; }
  if [ "$(dpkg-query -W -f='${Version}' tailscale 2>/dev/null)" != "$version" ]; then
    # Tailscale is for reaching the cabinet, never for playing: a failure here is logged and provisioning goes on.
    curl -fsSL -o "$keyring.new" https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg || { log "tailscale: couldn't fetch its key; skipped"; return 0; }
    fpr="$(gpg --show-keys --with-colons "$keyring.new" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }' || true)"
    [ "$fpr" = "$TAILSCALE_KEY_FPR" ] || { rm -f "$keyring.new"; log "tailscale: the signing key isn't Tailscale's ($fpr); skipped"; return 0; }
    mv "$keyring.new" "$keyring"
    printf 'deb [signed-by=%s] https://pkgs.tailscale.com/stable/debian trixie main\n' "$keyring" > "$list"
    if ! apt-get update -qq -o Dir::Etc::sourcelist="$list" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 ||
      ! DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "tailscale=$version"; then
      log "tailscale: install of $version failed; skipped"
      return 0
    fi
  fi
  systemctl enable --now tailscaled >/dev/null 2>&1 || true
  log "tailscale: $version, tailscaled running; sign in once (docs/flash-day.md)"
}

step_harden() {
  step_journal_persistent
  step_cloud_init_off
  step_usb_gadget
  step_tailscale
}

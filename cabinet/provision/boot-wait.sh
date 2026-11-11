# Sourced by provision.sh, for both profiles (D244).
# Pi OS Lite runs its network with NetworkManager, but systemd's first-boot presets also enable networkd and
# its wait-online. With nothing for networkd to manage, that wait runs its full 2 minutes and fails on every
# boot, holding network-online.target and everything after it. Mask it (a mask outlasts a later preset run),
# but only where NetworkManager runs the network and networkd has no network of ours to wait for.
# /usr/lib/systemd/network's own .network files only match container and tunnel links, so they don't count.
NETWORKD_DIRS="${NETWORKD_DIRS:-/etc/systemd/network /run/systemd/network}"

networkd_has_networks() {
  local d
  for d in $NETWORKD_DIRS; do
    compgen -G "$d/*.network" >/dev/null && return 0
  done
  return 1
}

step_boot_wait() {
  if ! systemctl is-enabled --quiet NetworkManager.service 2>/dev/null; then
    log "NetworkManager isn't enabled: leaving networkd's wait-online as it is"
    return 0
  fi
  if networkd_has_networks; then
    log "networkd has networks to wait for: leaving its wait-online as it is"
    return 0
  fi
  systemctl disable systemd-networkd-wait-online.service >/dev/null 2>&1 || true
  systemctl mask systemd-networkd-wait-online.service
  # This boot's timed-out run would otherwise stay listed as failed until the next restart.
  systemctl reset-failed systemd-networkd-wait-online.service 2>/dev/null || true
}

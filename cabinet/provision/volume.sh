# The Picade's speaker volume (D420), sourced by provision.sh and called from the picade profile's hw_late.
# Geoff (2026-11-14): the X HAT's speaker is far too loud as it comes. Every card starts at 30%, stored, and a
# level someone has chosen since (the Manager's slider, the cabinet's controls) is never reset: arcade-volume
# sets the default only when no level is stored. On a first boot the DAC isn't there yet (its overlay starts
# at the restart, D250), so the same check runs at every boot, before the kiosk. Safe to run again.
VOLUME_BIN="${VOLUME_BIN:-/usr/local/bin/arcade-volume}"
VOLUME_UNIT="${VOLUME_UNIT:-/etc/systemd/system/arcade-volume-default.service}"

step_volume() {
  install -m 0755 "$SELF_DIR/files/arcade-volume" "$VOLUME_BIN"
  install -m 0644 "$SELF_DIR/files/arcade-volume-default.service" "$VOLUME_UNIT"
  systemctl daemon-reload
  systemctl enable arcade-volume-default >/dev/null 2>&1
  # Never stops provisioning: a cabinet with no sound yet still gets its shelf.
  log "speaker volume: $("$VOLUME_BIN" default 2>&1 || true)"
}

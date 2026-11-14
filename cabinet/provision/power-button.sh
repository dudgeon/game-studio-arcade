# The Picade's power button (D371), sourced by provision.sh and called from the picade profile's hw_late.
# Geoff's choice (2026-11-14): "Tap ignored, hold to switch off". logind ignores the key; arcade-powerkey switches the
# cabinet off cleanly once the button has been held for 2 s (/etc/arcade/power-button changes it). Switching it
# on is the X HAT's own. Safe to run again.
LOGIND_DROPIN="${LOGIND_DROPIN:-/etc/systemd/logind.conf.d/arcade-power.conf}"

step_power_button() {
  install -m 0755 "$SELF_DIR/files/arcade-powerkey" /usr/local/bin/arcade-powerkey
  install -m 0644 "$SELF_DIR/files/arcade-powerkey.service" /etc/systemd/system/arcade-powerkey.service
  install -d "$(dirname "$LOGIND_DROPIN")"
  printf '# D371: a tap of the power button does nothing; arcade-powerkey switches off on a hold.\n[Login]\nHandlePowerKey=ignore\nHandlePowerKeyLongPress=ignore\n' > "$LOGIND_DROPIN.new"
  if ! cmp -s "$LOGIND_DROPIN.new" "$LOGIND_DROPIN"; then
    mv "$LOGIND_DROPIN.new" "$LOGIND_DROPIN"
    # logind reads it on reload; it keeps sessions, and the kiosk doesn't use one.
    systemctl kill -s HUP systemd-logind 2>/dev/null || true
  else
    rm -f "$LOGIND_DROPIN.new"
  fi
  systemctl daemon-reload
  systemctl enable arcade-powerkey >/dev/null 2>&1
  systemctl restart arcade-powerkey
  log "power button: a tap does nothing, a ${POWER_HOLD:-2} s hold switches off (D371)"
}

# The update's guards on the cabinet (D334-D336). Sourced by provision.sh (every first boot and update) and by
# update-on-cabinet.sh before it changes anything, so a cabinet flashed before these existed gets them on its
# first update. SELF_DIR is the unpacked provisioning folder. Safe to run again.
#
#   /usr/local/lib/arcade-update/   update-lib.sh, arcade-update-recover, arcade-boot
#   arcade-update-recover.service   at every boot: finish or undo a cut-off update (D334), the OS network watch (D333)
#   arcade-boot-confirm.service     Picade: keep a tried boot or go back to the last one (D336)
#   boot packages held, and the bootloader's own self-update at boot masked (D335)
#   Picade: systemd kicks the hardware watchdog, so a hung kernel restarts the Pi (D336)
# Every file goes through put_file: flushed before it's renamed into place, so a power cut can't leave it empty.
UPDATE_LIB="${UPDATE_LIB:-/usr/local/lib/arcade-update}"

step_update_guard() {
  # shellcheck source=update-lib.sh
  . "$SELF_DIR/update-lib.sh"
  local tmp
  tmp="$(mktemp -d)"
  install -d -m 0755 "$UPDATE_LIB" /var/lib/arcade-update
  put_file "$SELF_DIR/update-lib.sh" "$UPDATE_LIB/update-lib.sh" 0644
  put_file "$SELF_DIR/files/arcade-update-recover" "$UPDATE_LIB/arcade-update-recover" 0755
  put_file "$SELF_DIR/files/arcade-boot" "$UPDATE_LIB/arcade-boot" 0755
  ln -sfn "$UPDATE_LIB/arcade-boot" /usr/local/sbin/arcade-boot
  put_file "$SELF_DIR/files/arcade-update-recover.service" /etc/systemd/system/arcade-update-recover.service 0644
  hold_boot
  # The bootloader updates itself at boot when apt brings a newer one; on the Picade that's a deliberate step (D335).
  systemctl mask rpi-eeprom-update.service >/dev/null 2>&1 || true
  if [ "${PROFILE:-$(sed -n 's/^profile=//p' /etc/arcade/cabinet.conf 2>/dev/null)}" = picade ]; then
    cat > "$tmp/confirm" <<'UNIT'
[Unit]
Description=Keep a tried boot, or go back to the last good one (D336)
After=local-fs.target NetworkManager.service
ConditionPathExists=/var/lib/arcade-update/boot-try

[Service]
Type=exec
ExecStart=/usr/local/lib/arcade-update/arcade-boot confirm
TimeoutStartSec=20min

[Install]
WantedBy=multi-user.target
UNIT
    put_file "$tmp/confirm" /etc/systemd/system/arcade-boot-confirm.service 0644
    printf '[Manager]\nRuntimeWatchdogSec=15s\nRebootWatchdogSec=2min\n' > "$tmp/watchdog"
    put_file "$tmp/watchdog" /etc/systemd/system.conf.d/arcade-watchdog.conf 0644
    systemctl daemon-reload
    systemctl enable arcade-boot-confirm.service >/dev/null 2>&1
  else
    systemctl daemon-reload
  fi
  systemctl enable arcade-update-recover.service >/dev/null 2>&1
  rm -rf "$tmp"
  sync
}

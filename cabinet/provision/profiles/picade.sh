# Hardware layer for the real cabinet (D82, D83, D122). Sourced by provision.sh.
# Reviewed line by line against Pimoroni's picade-hat repo at the pinned commit and its setup guide (D253).
# Not run yet: the Picade hasn't arrived. docs/cabinet-bring-up.md lists what only the hardware can prove.
HOSTNAME_WANTED=arcade
CONFIG_TXT=/boot/firmware/config.txt
UDEV_RULES=/etc/udev/rules.d/10-picade.rules
ASOUND_CONF=/etc/asound.conf
# config.txt is read at boot, so a change to it wants a restart. firstboot.sh does that one restart (D250);
# an update leaves it to a person, and says so.
REBOOT_FLAG="${REBOOT_FLAG:-/run/arcade-reboot-wanted}"

hw_early() {
  wait_for_clock
}

# shellcheck source=/dev/null
. "$SELF_DIR/harden.sh"

hw_late() {
  step_overlay
  step_config_txt
  step_input_rule
  step_sound
  step_driver_keyboard
  step_power_button
  step_harden
}

# The Pi has no battery clock. Until NTP answers, the clock says the image's date, and apt refuses
# Release files "not valid yet". Wait up to 5 minutes for a sync, then carry on and let apt say why.
wait_for_clock() {
  local i
  for i in $(seq 1 60); do
    [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] && { log "clock synced"; return 0; }
    [ "$i" = 1 ] && log "waiting for the clock to sync"
    sleep 5
  done
  log "the clock still isn't synced; carrying on"
}

# D83: build the overlay at a pinned commit, not with the curl | bash installer.
# Pimoroni's Makefile does the same dtc call, and installs to /boot/firmware/overlays as here.
step_overlay() {
  local commit build
  commit="$(sed -n 's/.*"picade_hat_commit": *"\([^"]*\)".*/\1/p' "$SELF_DIR/lock.json")"
  if [ -f /boot/firmware/overlays/picade.dtbo ] && [ "$(cat /etc/arcade/picade-hat-commit 2>/dev/null)" = "$commit" ]; then
    return
  fi
  build="$(mktemp -d)"
  git -C "$build" init -q
  git -C "$build" fetch -q --depth 1 https://github.com/pimoroni/picade-hat "$commit"
  git -C "$build" checkout -q FETCH_HEAD
  dtc -I dts -O dtb -o "$build/picade.dtbo" "$build/picade.dts"
  install -m 0755 "$build/picade.dtbo" /boot/firmware/overlays/picade.dtbo
  install -d /etc/arcade
  echo "$commit" > /etc/arcade/picade-hat-commit
  rm -rf "$build"
}

# D82's key map and D83's power and audio lines, in one block we own.
config_block() {
  cat <<'CONF'
# BEGIN arcade provision
[all]
usb_max_current_enable=1
dtparam=audio=off
dtoverlay=picade
dtparam=button1=44
dtparam=button2=45
dtparam=button3=46
dtparam=button4=47
dtparam=button5=16
dtparam=button6=18
dtparam=start=28
dtparam=escape=1
dtparam=enter=59
dtparam=coin=60
# D396: the USB-C port as a network port for the mini (rpi-usb-gadget; harden.sh)
dtoverlay=dwc2,dr_mode=peripheral
# END arcade provision
CONF
}

# Pass the file, so a test can run this on a copy of the image's own config.txt.
# Our block is replaced where it stands (appended only if missing), so a later block, such as the boot slot's (D336),
# stays last. Unchanged text means no write to the FAT partition and no restart.
step_config_txt() {
  local file="${1:-$CONFIG_TXT}" new
  new="$(mktemp)"
  config_block > "$new.block"
  awk -v bf="$new.block" '
    function block(  l) { while ((getline l < bf) > 0) print l; close(bf); done = 1 }
    $0 == "# BEGIN arcade provision" { skip = 1; if (!done) block(); next }
    skip { if ($0 == "# END arcade provision") skip = 0; next }
    $0 == "dtoverlay=vc4-kms-v3d" { print "dtoverlay=vc4-kms-v3d,noaudio"; next }
    $0 == "dtparam=audio=on" { print "dtparam=audio=off"; next }
    { print }
    END { if (!done) block() }' "$file" > "$new"
  if ! cmp -s "$new" "$file"; then
    cat "$new" > "$file"
    log "config.txt changed: the Picade's driver and screen power start at the next boot"
    touch "$REBOOT_FLAG"
  fi
  rm -f "$new" "$new.block"
}

# Pimoroni's installer adds this rule: it tells udev, and so libinput and the kiosk, that the
# overlay's gpio_keys device is a keyboard.
# D287: the driver keyboard (D144) is installed here too, but runs only while /etc/arcade/driver-keyboard says
# "on". Nothing on the card makes that file: scripts/cabinet-card/driver-keyboard.sh on|off sets it over the
# admin SSH key, and the setting outlasts updates and restarts until it's switched off.
DRIVER_SETTING="${DRIVER_SETTING:-/etc/arcade/driver-keyboard}"
DRIVER_MODULES="${DRIVER_MODULES:-/etc/modules-load.d/arcade-driver.conf}"
driver_keyboard_on() {
  [ -f "$DRIVER_SETTING" ] && [ "$(tr -d '[:space:]' < "$DRIVER_SETTING")" = on ]
}

step_driver_keyboard() {
  install -m 0755 "$SELF_DIR/files/arcade-keyd" /usr/local/bin/arcade-keyd
  install -m 0644 "$SELF_DIR/files/arcade-keyd.service" /etc/systemd/system/arcade-keyd.service
  systemctl daemon-reload
  if driver_keyboard_on; then
    echo uinput > "$DRIVER_MODULES"
    modprobe uinput
    systemctl enable arcade-keyd
    systemctl restart arcade-keyd
    log "driver keyboard: on (D287)"
  else
    rm -f "$DRIVER_MODULES"
    systemctl disable --now arcade-keyd 2>/dev/null || true
    log "driver keyboard: off (D287)"
  fi
}

step_input_rule() {
  printf 'SUBSYSTEM=="input", ATTRS{name}=="gpio_keys", ENV{ID_INPUT_KEYBOARD}="1"\n' > "$UDEV_RULES"
  udevadm control --reload 2>/dev/null || true
}

# Sound goes to the X HAT's DAC by its card name, not "card 0" as in Pimoroni's file: the USB mic is
# a sound card too, and could come up first. dmix lets two sounds play at once; softvol gives a
# "PCM" volume control, which the DAC lacks. The mic's side is set when the mic is picked (D89).
asound_conf() {
  cat <<'ALSA'
# Written by the arcade provisioning script (D253). The X HAT's DAC is card "sndrpihifiberry".
pcm.hat {
  type hw
  card sndrpihifiberry
  device 0
}
pcm.dmixer {
  type dmix
  ipc_key 1024
  ipc_perm 0666
  slave.pcm "hat"
  slave {
    period_time 0
    period_size 1024
    buffer_size 8192
    rate 44100
  }
  bindings {
    0 0
    1 1
  }
}
ctl.dmixer {
  type hw
  card sndrpihifiberry
}
pcm.softvol {
  type softvol
  slave.pcm "dmixer"
  control {
    name "PCM"
    card sndrpihifiberry
  }
}
pcm.!default {
  type plug
  slave.pcm "softvol"
}
ctl.!default {
  type hw
  card sndrpihifiberry
}
ALSA
}
step_sound() {
  asound_conf > "$ASOUND_CONF"
  chmod 0644 "$ASOUND_CONF"
}

# Until connect-cabinet.sh gives it a key, the Picade plays offline: the shelf works, and Make waits (D252).
service_args_without_key() {
  echo "--offline"
}

kiosk_env() {
  cat <<'ENV'
ARCADE_OUTPUT=
CHROMIUM_EXTRA=
ENV
}

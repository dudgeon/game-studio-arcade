# Hardware layer for the real cabinet (D82, D83, D122). Sourced by provision.sh.
# Not run yet: the Picade hasn't arrived. Check all of it on arrival (V3).
HOSTNAME_WANTED=arcade
CONFIG_TXT=/boot/firmware/config.txt

hw_early() { :; }

hw_late() {
  step_overlay
  step_config_txt
}

# D83: build the overlay at a pinned commit, not with the curl | bash installer.
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
step_config_txt() {
  local begin='# BEGIN arcade provision' end='# END arcade provision'
  sed -i "/^$begin\$/,/^$end\$/d" "$CONFIG_TXT"
  sed -i -E 's/^dtoverlay=vc4-kms-v3d$/dtoverlay=vc4-kms-v3d,noaudio/; s/^dtparam=audio=on$/dtparam=audio=off/' "$CONFIG_TXT"
  cat >> "$CONFIG_TXT" <<CONF
$begin
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
$end
CONF
}

kiosk_env() {
  cat <<'ENV'
ARCADE_OUTPUT=
CHROMIUM_EXTRA=
ENV
}

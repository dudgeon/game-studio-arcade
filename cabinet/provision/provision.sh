#!/bin/bash
# The cabinet's provisioning script (D4, D122). Same script and lock on a stock
# Raspberry Pi OS Lite give the same cabinet. Every step is safe to run again.
#
#   provision.sh --profile picade|virtual --payload DIR
#
# DIR holds bundle.tar.gz (this repo's cabinet software) and, for the first
# run, authorized_keys and cabinet.conf. Nothing is read from the Mac mini at run time.
set -euo pipefail

PROFILE=""
PAYLOAD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --payload) PAYLOAD="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$PROFILE" in picade|virtual) ;; *) echo "--profile must be picade or virtual" >&2; exit 2 ;; esac
[ -n "$PAYLOAD" ] && [ -f "$PAYLOAD/bundle.tar.gz" ] || { echo "--payload DIR must hold bundle.tar.gz" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCADE_HOME=/opt/arcade
DATA=/var/lib/arcade
log() { echo "[provision $(date -u +%H:%M:%S)] $*"; }

# shellcheck source=/dev/null
. "$SELF_DIR/profiles/$PROFILE.sh"

step_hostname() {
  if [ "$(cat /etc/hostname 2>/dev/null)" != "$HOSTNAME_WANTED" ]; then
    echo "$HOSTNAME_WANTED" > /etc/hostname
    hostname "$HOSTNAME_WANTED" || true
  fi
  sed -i '/^127\.0\.1\.1\b/d' /etc/hosts
  echo "127.0.1.1 $HOSTNAME_WANTED" >> /etc/hosts
}

step_apt() {
  local pkgs missing=() line name want have
  mapfile -t pkgs < <(grep -vE '^[[:space:]]*(#|$)' "$SELF_DIR/apt.lock")
  for line in "${pkgs[@]}"; do
    name="${line%%=*}"
    want="${line#*=}"; [ "$want" = "$line" ] && want=""
    have="$(dpkg-query -W -f='${db:Status-Status} ${Version}' "$name" 2>/dev/null || true)"
    case "$have" in
      "installed $want"|installed\ *) [ -z "$want" ] || [ "$have" = "installed $want" ] || missing+=("$line") ;;
      *) missing+=("$line") ;;
    esac
  done
  if [ ${#missing[@]} -gt 0 ]; then
    log "installing: ${missing[*]}"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

step_users() {
  # arcade runs the kiosk and has no sudo. cabinet is the admin who logs in over SSH.
  id arcade >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin arcade
  usermod -aG video,input,render,audio arcade
  id cabinet >/dev/null 2>&1 || useradd --create-home --shell /bin/bash cabinet
  usermod -aG sudo,systemd-journal cabinet
  passwd -l cabinet >/dev/null
  printf 'cabinet ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/010-cabinet
  chmod 0440 /etc/sudoers.d/010-cabinet
}

step_ssh() {
  ssh-keygen -A
  install -d -m 0700 -o cabinet -g cabinet /home/cabinet/.ssh
  if [ -f "$PAYLOAD/authorized_keys" ]; then
    install -m 0600 -o cabinet -g cabinet "$PAYLOAD/authorized_keys" /home/cabinet/.ssh/authorized_keys
  fi
  cat > /etc/ssh/sshd_config.d/10-arcade.conf <<'CONF'
PasswordAuthentication no
PermitRootLogin no
CONF
  systemctl enable --now ssh
}

step_bundle() {
  # Each version gets its own folder, and `current` points at the latest (never deleted).
  local version release
  version="$(sed -n 's/.*"provision_version": *"\([^"]*\)".*/\1/p' "$SELF_DIR/lock.json")"
  release="$ARCADE_HOME/releases/$version-$(sha256sum "$PAYLOAD/bundle.tar.gz" | cut -c1-12)"
  if [ ! -d "$release" ]; then
    install -d "$release.tmp"
    tar -xzf "$PAYLOAD/bundle.tar.gz" -C "$release.tmp"
    # The same links npm's workspaces make. These packages have no outside dependencies at run time.
    install -d "$release.tmp/node_modules/@game-studio-arcade"
    ln -sfn ../../runtime "$release.tmp/node_modules/@game-studio-arcade/runtime"
    ln -sfn ../../studio-kit/spec "$release.tmp/node_modules/@game-studio-arcade/spec"
    ln -sfn ../../studio-kit/player "$release.tmp/node_modules/@game-studio-arcade/player"
    ln -sfn ../../studio-kit/playtest "$release.tmp/node_modules/@game-studio-arcade/playtest"
    mv "$release.tmp" "$release"
  fi
  ln -sfn "$release" "$ARCADE_HOME/current"
}

step_carts() {
  # The cabinet's own library. Add only what's missing: a cart is never overwritten (D5).
  install -d -o arcade -g arcade "$DATA" "$DATA/carts" "$DATA/logs"
  local src id
  for src in "$ARCADE_HOME"/current/studio-kit/context-pack/carts/*/; do
    id="$(basename "$src")"
    if [ ! -e "$DATA/carts/$id" ]; then
      cp -R "$src" "$DATA/carts/$id"
      chown -R arcade:arcade "$DATA/carts/$id"
    fi
  done
}

step_services() {
  install -m 0755 "$SELF_DIR/files/arcade-session" /usr/local/bin/arcade-session
  install -m 0755 "$SELF_DIR/files/arcade-screenshot" /usr/local/bin/arcade-screenshot
  install -m 0644 "$SELF_DIR/files/arcade-launcher.service" /etc/systemd/system/arcade-launcher.service
  install -m 0644 "$SELF_DIR/files/arcade-kiosk.service" /etc/systemd/system/arcade-kiosk.service
  install -d /etc/arcade
  kiosk_env > /etc/arcade/kiosk.env
  printf 'profile=%s\nplayers=1\n' "$PROFILE" > /etc/arcade/cabinet.conf
  systemctl daemon-reload
  systemctl disable --now getty@tty1.service 2>/dev/null || true
  systemctl set-default multi-user.target >/dev/null
  systemctl enable avahi-daemon arcade-launcher arcade-kiosk
  systemctl restart avahi-daemon arcade-launcher
  systemctl restart arcade-kiosk
}

log "profile $PROFILE"
step_hostname
hw_early
step_apt
step_users
step_ssh
step_bundle
step_carts
hw_late
step_services
install -d /etc/arcade
sed -n 's/.*"provision_version": *"\([^"]*\)".*/\1/p' "$SELF_DIR/lock.json" > /etc/arcade/provisioned-version
log "done"

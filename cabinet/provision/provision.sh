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
# shellcheck source=/dev/null
. "$SELF_DIR/boot-wait.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/timezone.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/speech.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/cabinet-config.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/twin-data.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/library.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/update-guard.sh"

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

# D9: Node 22 everywhere, from nodejs.org, pinned by SHA-256 in lock.json.
lock_value() { sed -n "/\"node\": {/,/}/s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$SELF_DIR/lock.json"; }

step_node() {
  local version name url sha dest tarball
  version="$(lock_value version)"; name="$(lock_value name)"; url="$(lock_value url)"; sha="$(lock_value sha256)"
  dest="$ARCADE_HOME/node/$version"
  if [ ! -x "$dest/bin/node" ]; then
    tarball="$PAYLOAD/$name"
    if [ ! -f "$tarball" ]; then
      tarball="$(mktemp)"
      curl -fsSL -o "$tarball" "$url"
    fi
    echo "$sha  $tarball" | sha256sum -c -
    install -d "$dest.tmp"
    tar -xJf "$tarball" -C "$dest.tmp" --strip-components=1
    # On disk before it has its final name: a power cut must not leave a named folder of empty files (D334).
    sync
    mv "$dest.tmp" "$dest"
  fi
  ln -sfn "$dest/bin/node" /usr/local/bin/node
}

step_bundle() {
  # Each version gets its own folder, and `current` points at the latest (never deleted).
  local version release
  version="$(sed -n 's/.*"provision_version": *"\([^"]*\)".*/\1/p' "$SELF_DIR/lock.json")"
  release="$ARCADE_HOME/releases/$version-$(sha256sum "$PAYLOAD/bundle.tar.gz" | cut -c1-12)"
  if [ ! -d "$release" ]; then
    install -d "$release.tmp"
    tar -xzf "$PAYLOAD/bundle.tar.gz" -C "$release.tmp"
    # Exact versions from the repo's lock file, each checked by its hash; no install scripts run.
    (cd "$release.tmp" && PATH="$ARCADE_HOME/node/$(lock_value version)/bin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
    # On disk before it has its final name: a named release is never unpacked again, so a power cut must not
    # leave one of empty files (D334, found in the rehearsal of 2026-11-13).
    sync
    mv "$release.tmp" "$release"
  fi
  ln -sfn "$release" "$ARCADE_HOME/current"
  RELEASE_NAME="$(basename "$release")"
}

step_carts() {
  # The cabinet's own library. Add only what's missing: a cart is never overwritten (D5).
  install -d -o arcade -g arcade "$DATA" "$DATA/carts" "$DATA/logs"
  local name src id
  # Three of the context pack's playable starting points (D161), under their carts' own ids.
  for name in catch dodge paddle; do
    src="$ARCADE_HOME/current/studio-kit/context-pack/templates/$name"
    id="$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$src/cart.json")"
    [ -n "$id" ] || { echo "no id in $src/cart.json" >&2; return 1; }
    STARTER_IDS="$STARTER_IDS $id" # step_library commits them, on a new library (D390)
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
  # The cabinet's own key file (D131) means live. Without one, the profile says what to do.
  if [ -f /etc/arcade/service.json ]; then
    echo 'ARCADE_SERVICE_ARGS=--config /etc/arcade/service.json' > /etc/arcade/service.env
  else
    echo "ARCADE_SERVICE_ARGS=$(service_args_without_key)" > /etc/arcade/service.env
  fi
  systemctl daemon-reload
  systemctl disable --now getty@tty1.service 2>/dev/null || true
  systemctl set-default multi-user.target >/dev/null
  systemctl enable avahi-daemon arcade-launcher arcade-kiosk
  systemctl restart avahi-daemon arcade-launcher
  # Don't wait on the screen: a kiosk problem must not stop provisioning. verify.sh checks it.
  systemctl restart --no-block arcade-kiosk
}

# "== N/M what": a line firstboot.sh puts on the cabinet's screen, so first boot isn't a blank screen (D257).
STAGES=8
STAGE=0
stage() { STAGE=$((STAGE + 1)); log "== $STAGE/$STAGES $*"; }

log "profile $PROFILE"
step_hostname
step_timezone
stage "Checking the clock"
hw_early
stage "Installing the screen and the browser (the longest step)"
step_apt
step_users
step_ssh
stage "Installing Node"
step_node
stage "Unpacking the arcade"
step_bundle
step_twin_data
step_carts
step_library
step_cabinet_config
stage "Installing speech: Moonshine and its model, about 400 MB"
step_speech
stage "Setting up the cabinet's buttons, sound and screen"
hw_late
step_boot_wait
stage "Starting the arcade"
step_services
step_update_guard
stage "Finishing"
install -d /etc/arcade
echo "$RELEASE_NAME" > /etc/arcade/provisioned-version
[ ! -f "$PAYLOAD/commit" ] || install -m 0644 "$PAYLOAD/commit" /etc/arcade/provisioned-commit
log "done"

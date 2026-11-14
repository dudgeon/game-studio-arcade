# What an update and its recovery share (D330-D336). Sourced by update-on-cabinet.sh, which ships with each
# update, and by arcade-update-recover, which update-guard.sh installs beside it in /usr/local/lib/arcade-update.
# Bash. Every function is safe to run again: a power cut can stop any of them, and the next boot runs the
# recovery, which calls them again (D334).
#
# The cabinet's update state, in STATE (never under the data folder, so the data check never sees it):
#   pending      written before anything changes, removed after result.json: what to put back if cut off
#   last-good    the payload folder of the last update that finished well
#   os-watch     after OS packages changed: the next boot checks the network, and puts them back if it's gone
STATE="${ARCADE_UPDATE_STATE:-/var/lib/arcade-update}"
ARCADE_HOME="${ARCADE_HOME:-/opt/arcade}"
SEED="${ARCADE_SEED:-/boot/firmware/seed}"
SERVICE="${ARCADE_SERVICE_URL:-http://127.0.0.1:8330}"

# Packages that change what the Pi boots: kernel, boot firmware, bootloader, Wi-Fi firmware (D335). An OS update
# never moves them; only the deliberate boot update does, through tryboot (D336). Patterns for dpkg-query.
BOOT_PACKAGES="linux-image-* linux-headers-* linux-kbuild-* raspi-firmware rpi-eeprom firmware-brcm80211 raspberrypi-sys-mods initramfs-tools* rpi-update"

ulog() { echo "[update $(date -u +%H:%M:%S)] $*"; }

# Why the cabinet is busy, or nothing (D332). A make running or left to collect, a game being played, or the publish
# gate checking a game. A service that doesn't answer isn't busy: a broken cabinet must still take a fix.
busy_reason() {
  local data="${1:-/var/lib/arcade}" phase left playing
  phase="$(node -e 'fetch(process.argv[1] + "/api/studio").then((r) => r.json()).then((s) => console.log(s.phase), () => console.log("unknown"))' "$SERVICE" 2>/dev/null)"
  if [ "$phase" = running ] || [ -e "$data/studio-run.json" ]; then echo "a make is running"; return; fi
  left="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length) } catch { console.log(0) }' "$data/studio-left.json" 2>/dev/null)"
  if [ "${left:-0}" != 0 ]; then echo "$left make(s) cut off by a restart are still to be collected. Try again once the shelf shows how they ended"; return; fi
  playing="$(node -e 'fetch(process.argv[1] + "/api/arcade/playing").then((r) => r.ok ? r.json() : {}).then((p) => console.log(p.playing ? "game " + (p.what || "") : p.gate_busy ? "gate" : ""), () => console.log(""))' "$SERVICE" 2>/dev/null)"
  case "$playing" in
    game*) echo "a game is being played (${playing#game })" ;;
    gate) echo "the publish gate is checking a game" ;;
  esac
}

service_up() {
  local i tries="${1:-30}"
  for i in $(seq 1 "$tries"); do
    if systemctl is-active --quiet arcade-launcher && node -e 'fetch(process.argv[1] + "/api/config").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$SERVICE" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

# The cabinet's own network, without the mini (the mini may be off, D1): a default route, and its gateway answers a
# ping or at least ARP (some networks drop pings). SSH must be running too, or the mini can't come back in (D333).
net_ok() {
  local gw i
  for i in $(seq 1 "${1:-15}"); do
    gw="$(ip -4 route show default 2>/dev/null | awk '{ print $3; exit }')"
    if [ -n "$gw" ] && systemctl is-active --quiet ssh; then
      ping -c 1 -W 2 "$gw" >/dev/null 2>&1 && return 0
      case "$(ip neigh show "$gw" 2>/dev/null)" in *REACHABLE*|*STALE*|*DELAY*|*PROBE*|*PERMANENT*) return 0 ;; esac
    fi
    sleep 2
  done
  return 1
}

# key=value lines, so a half-written file is never read: written beside, then moved (rename is atomic on ext4).
state_write() { # FILE key=value...
  local f="$1"; shift
  install -d -m 0755 "$(dirname "$f")"
  printf '%s\n' "$@" > "$f.new" && sync "$f.new" 2>/dev/null; mv "$f.new" "$f"; sync "$(dirname "$f")" 2>/dev/null || true
}
state_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1; }

# Points `current` at a release in one step: a new link beside it, renamed over it (D334).
point_current() {
  ln -sfn "$1" "$ARCADE_HOME/current.new" && mv -T "$ARCADE_HOME/current.new" "$ARCADE_HOME/current"
}

# The payload that made a release, so a rollback can run that release's own provisioning (D331): the last good
# update's, else the card's seed, whichever has the release's bundle. A release is named VERSION-<bundle sha, 12>.
payload_for_release() {
  local release="$1" want p
  want="${release##*-}"
  for p in "$(cat "$STATE/last-good" 2>/dev/null)" "$SEED"; do
    [ -n "$p" ] && [ -f "$p/bundle.tar.gz" ] && [ -f "$p/provision.tar.gz" ] || continue
    [ "$(sha256sum "$p/bundle.tar.gz" | cut -c1-12)" = "$want" ] && { echo "$p"; return 0; }
  done
  return 1
}

# Puts the cabinet software back to RELEASE (D331): its own provisioning script, from its own payload, so units,
# helpers and settings match it too; or, with no payload for it, the release link alone, as before D331.
software_back() { # RELEASE VERSION_FILE_VALUE COMMIT PROFILE
  local release="$1" version="$2" commit="$3" profile="$4" from work=/opt/arcade/provision
  ulog "putting the cabinet software back to $(basename "$release")"
  point_current "$release"
  from="$(payload_for_release "$(basename "$release")")" || from=""
  if [ -n "$from" ]; then
    ulog "running that release's own provisioning, from $from"
    rm -rf "$work.back"; install -d "$work.back"
    if tar -xzf "$from/provision.tar.gz" -C "$work.back" && /bin/bash "$work.back/provision.sh" --profile "$profile" --payload "$from"; then
      rm -rf "$work"; mv "$work.back" "$work"
    else
      ulog "its provisioning didn't finish: the release link is back, and the service restarts on it"
      point_current "$release"
    fi
  fi
  echo "$version" > /etc/arcade/provisioned-version
  if [ -n "$commit" ]; then echo "$commit" > /etc/arcade/provisioned-commit; fi
  systemctl daemon-reload
  systemctl restart arcade-launcher
  systemctl restart --no-block arcade-kiosk
}

# The installed version of each named package, as "name=version" (D335). Unknown names are skipped.
apt_versions() {
  local p
  for p in "$@"; do dpkg-query -W -f='${db:Status-Status} ${Package}=${Version}\n' "$p" 2>/dev/null | sed -n 's/^installed //p'; done
}

# Keeps a .deb of each package as installed now, in DIR, before apt changes it (D335). dpkg-repack builds it
# from the installed files, so it works for packages the image came with, which apt never downloaded.
apt_save() { # DIR name=version...
  local dir="$1" line name; shift
  install -d "$dir"
  [ $# -gt 0 ] || return 0
  command -v dpkg-repack >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends dpkg-repack >/dev/null || return 1
  printf '%s\n' "$@" > "$dir/versions"
  for line in "$@"; do
    name="${line%%=*}"
    ls "$dir/${name}_"*.deb >/dev/null 2>&1 && continue
    (cd "$dir" && dpkg-repack "$name" >/dev/null 2>&1) || { ulog "couldn't keep a copy of $name"; return 1; }
  done
}

# Puts back what apt_save kept, finishing any install a power cut stopped first (D334, D335).
apt_back() { # DIR
  local dir="$1"
  dpkg --configure -a || true
  ls "$dir"/*.deb >/dev/null 2>&1 || return 0
  ulog "putting back $(ls "$dir"/*.deb | wc -l) packages as they were"
  DEBIAN_FRONTEND=noninteractive dpkg -i --force-confold --force-downgrade "$dir"/*.deb && dpkg --configure -a
}

# Holds the boot packages, so no OS update moves them (D335). Only the deliberate boot update lifts this.
hold_boot() {
  local names
  names="$(dpkg-query -W -f='${Package}\n' $BOOT_PACKAGES 2>/dev/null | sort -u)"
  [ -z "$names" ] || apt-mark hold $names >/dev/null
}

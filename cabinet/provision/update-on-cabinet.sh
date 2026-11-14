#!/bin/bash
# Runs on the cabinet, as root, in its own systemd unit, so a dropped SSH connection can't stop it halfway
# (D195). Started by scripts/virtual-cabinet/update-cabinet.mjs with a payload folder that holds bundle.tar.gz,
# provision.tar.gz and commit, and "os" when the OS packages are to be updated too (D330). It runs the newer
# provisioning script over the cabinet as it stands (D4), proves every piece of the cabinet's data came through
# (D196), and writes result.json for the mini. Prints no secrets.
#
# Safe ways back (D331-D335):
#   - It won't start during a make, a game or a gate check (D332).
#   - Before it changes anything it writes $STATE/pending. If the power goes, the next boot's
#     arcade-update-recover puts the cabinet back as it was and writes result.json (D334).
#   - The software rolls back with its own provisioning script, from the payload that made it (D331).
#   - OS packages: a copy of each is kept before apt changes it, and put back if the cabinet doesn't come back
#     healthy: the service answering, SSH running, and its own Wi-Fi reaching the router (D333, D335).
#   - It never moves the boot packages (kernel, boot firmware, bootloader): that's scripts/cabinet-card/boot-update
#     through tryboot (D336).
set -u
PAYLOAD="${1:?payload folder}"
RESULT="$PAYLOAD/result.json"
DATA=/var/lib/arcade
CONFIG=/etc/arcade/service.json
# shellcheck source=update-lib.sh
. "$(dirname "$0")/update-lib.sh" 2>/dev/null || { tar -xzf "$PAYLOAD/provision.tar.gz" -C "$PAYLOAD" ./update-lib.sh && . "$PAYLOAD/update-lib.sh"; }
log() { ulog "$@"; }
exec >> "$PAYLOAD/update.log" 2>&1

[ ! -e "$RESULT" ] || { log "already ran"; exit 0; }
[ ! -e "$PAYLOAD/started" ] || { log "already started"; exit 0; }
: > "$PAYLOAD/started"

DATA_KEPT=false
DATA_REPORT=null
ROLLED_BACK=false
ACTIVE=false
OS_REPORT=null
REBOOT_WANTED=false
SOFTWARE_GOOD=no

finish() { # finish OK REASON
  local temp="$RESULT.new"
  [ -e /run/arcade-reboot-wanted ] || [ -e /run/reboot-required ] && REBOOT_WANTED=true
  node -e '
    const [ok, reason, before, after, commit, configWas, configIs, dataKept, report, rolledBack, active, os, reboot] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ ok: ok === "true", reason, version_before: before, version_after: after, commit,
      config_before: configWas, config_after: configIs, data_kept: dataKept === "true", data: JSON.parse(report),
      rolled_back: rolledBack === "true", service_active: active === "true", os: JSON.parse(os), restart_wanted: reboot === "true" }, null, 1) + "\n");
  ' "$1" "$2" "$BEFORE" "$(cat /etc/arcade/provisioned-version 2>/dev/null)" "$(cat "$PAYLOAD/commit" 2>/dev/null)" \
    "$CONFIG_BEFORE" "$(config_print)" "$DATA_KEPT" "$DATA_REPORT" "$ROLLED_BACK" "$ACTIVE" "$OS_REPORT" "$REBOOT_WANTED" > "$temp"
  mv "$temp" "$RESULT"
  sync "$RESULT" 2>/dev/null || true
  # The software this payload made is good once it came up healthy, whatever the OS packages did (D331).
  [ "$SOFTWARE_GOOD" = yes ] && state_write "$STATE/last-good" "$PAYLOAD"
  rm -f "$STATE/pending"
  log "finished: ok=$1 $2"
  exit 0
}

# What the config is, without its contents: a hash, its mode and its owner.
config_print() {
  if [ -e "$CONFIG" ]; then echo "$(sha256sum "$CONFIG" | cut -c1-16) $(stat -c '%a %U' "$CONFIG")"; else echo absent; fi
}
# Every file under the data folder, apart from the browser's cache, against the record taken before (D196).
data_check() {
  DATA_REPORT="$(node "$PAYLOAD/check/data-check.mjs" check "$DATA" "$PAYLOAD/data.before")" && DATA_KEPT=true || DATA_KEPT=false
  [ -n "$DATA_REPORT" ] || DATA_REPORT=null
  log "data: $DATA_REPORT"
}
# Healthy after a change: the service answers and, if it could before, the cabinet still reaches its router (D333).
healthy() {
  service_up || { log "the service didn't come back"; return 1; }
  if [ "$NET_BEFORE" = yes ] && ! net_ok; then log "the cabinet lost its network"; return 1; fi
  return 0
}

BEFORE="$(cat /etc/arcade/provisioned-version 2>/dev/null)"
COMMIT_BEFORE="$(cat /etc/arcade/provisioned-commit 2>/dev/null)"
CONFIG_BEFORE="$(config_print)"
PREVIOUS="$(readlink -f /opt/arcade/current)"

# The update's own checks and guards come from this payload, so they're the ones it ships.
install -d "$PAYLOAD/check"
tar -xzf "$PAYLOAD/provision.tar.gz" -C "$PAYLOAD/check" ./data-check.mjs ./update-guard.sh ./update-lib.sh ./apt.lock ./files/arcade-update-recover ./files/arcade-update-recover.service ./files/arcade-boot || finish false "couldn't unpack the update's own checks"

# An earlier update cut off without a restart since: put that right first, with this payload's recovery (D334).
if [ -e "$STATE/pending" ]; then
  log "an earlier update didn't finish: recovering it first"
  /bin/bash "$PAYLOAD/check/files/arcade-update-recover" || true
  BEFORE="$(cat /etc/arcade/provisioned-version 2>/dev/null)"
  COMMIT_BEFORE="$(cat /etc/arcade/provisioned-commit 2>/dev/null)"
  PREVIOUS="$(readlink -f /opt/arcade/current)"
fi

# The service writes the cabinet's data during a make, and when it starts with sessions left to collect (D191).
# An update restarts it, so it waits for neither; nor for a game being played or checked (D332).
busy="$(busy_reason "$DATA")"
if [ -n "$busy" ]; then
  ACTIVE=true; DATA_KEPT=true
  finish false "$busy: nothing was changed"
fi

PROFILE="$(sed -n 's/^profile=//p' /etc/arcade/cabinet.conf)"
case "$PROFILE" in picade|virtual) ;; *) finish false "this cabinet doesn't say which profile it is" ;; esac

node "$PAYLOAD/check/data-check.mjs" record "$DATA" "$PAYLOAD/data.before" || finish false "couldn't record the data before updating"
net_ok 5 && NET_BEFORE=yes || NET_BEFORE=no
log "from $BEFORE, profile $PROFILE, commit $(cat "$PAYLOAD/commit"), network ${NET_BEFORE}"

# The power-cut guard goes on before the first change, so even this update is covered (D334).
( SELF_DIR="$PAYLOAD/check"; . "$PAYLOAD/check/update-guard.sh"; step_update_guard ) || finish false "couldn't install the power-cut guard"

# 1. Packages the provisioning script will move (apt.lock, D335): a copy of each as it is now.
mapfile -t lock_lines < <(grep -vE '^[[:space:]]*(#|$)' "$PAYLOAD/check/apt.lock" 2>/dev/null)
locked=()
moving=()
for line in "${lock_lines[@]}"; do
  name="${line%%=*}"; locked+=("$name")
  have="$(apt_versions "$name")"
  [ -n "$have" ] && [ "$line" != "$name" ] && [ "$have" != "$line" ] && moving+=("$have")
done
if [ ${#moving[@]} -gt 0 ]; then
  log "apt.lock moves: ${moving[*]}"
  apt_save "$PAYLOAD/lock-before" "${moving[@]}" || finish false "couldn't keep a copy of the packages apt.lock moves: nothing was changed"
fi

# Everything so far on disk before the first change: the payload, the data record, the guard and the package copies.
sync
state_write "$STATE/pending" "payload=$PAYLOAD" "stage=software" "previous=$PREVIOUS" "version=$BEFORE" "commit=$COMMIT_BEFORE" "profile=$PROFILE" "net=$NET_BEFORE"

software_rollback() {
  ROLLED_BACK=true
  apt_back "$PAYLOAD/lock-before"
  software_back "$PREVIOUS" "$BEFORE" "$COMMIT_BEFORE" "$PROFILE"
  service_up && ACTIVE=true
  data_check
}

# 2. The cabinet software (D195).
WORK=/opt/arcade/provision
rm -rf "$WORK.new"
install -d "$WORK.new"
if ! tar -xzf "$PAYLOAD/provision.tar.gz" -C "$WORK.new"; then finish false "couldn't unpack the provisioning script"; fi
rm -rf "$WORK"
mv "$WORK.new" "$WORK"
if ! /bin/bash "$WORK/provision.sh" --profile "$PROFILE" --payload "$PAYLOAD"; then
  software_rollback
  finish false "the provisioning script failed: see $PAYLOAD/update.log"
fi
if ! healthy; then
  software_rollback
  finish false "the cabinet wasn't healthy on the new version"
fi
ACTIVE=true
SOFTWARE_GOOD=yes

# 3. OS packages, if asked (D335): everything but the boot packages and apt.lock's own, which stay as pinned.
if [ -e "$PAYLOAD/os" ]; then
  state_write "$STATE/pending" "payload=$PAYLOAD" "stage=os" "previous=$PREVIOUS" "version=$BEFORE" "commit=$COMMIT_BEFORE" "profile=$PROFILE" "net=$NET_BEFORE" "software=done"
  hold_boot
  dpkg --configure -a
  if ! apt-get update -q; then
    OS_REPORT='{"changed":0,"note":"couldn'"'"'t reach the package servers"}'
    data_check
    finish false "the software updated, but the cabinet couldn't reach the package servers for its OS packages"
  fi
  held_now=$(apt-mark showhold | sort -u)
  [ ${#locked[@]} -eq 0 ] || apt-mark hold "${locked[@]}" >/dev/null 2>&1
  mapfile -t plan < <(apt-get -s -q upgrade 2>/dev/null | awk '/^Inst /{ v=$3; gsub(/[\[\]]/, "", v); print $2 "=" v }')
  log "OS packages to update: ${#plan[@]}"
  ok=yes
  if [ ${#plan[@]} -gt 0 ]; then
    free_kb="$(df --output=avail -k /var/lib/arcade-update | tail -1)"
    if [ "${free_kb:-0}" -lt 2000000 ]; then ok=space
    elif ! apt_save "$PAYLOAD/os-before" "${plan[@]}"; then ok=save
    else
      state_write "$STATE/pending" "payload=$PAYLOAD" "stage=os" "previous=$PREVIOUS" "version=$BEFORE" "commit=$COMMIT_BEFORE" "profile=$PROFILE" "net=$NET_BEFORE" "software=done" "os_saved=$PAYLOAD/os-before"
      DEBIAN_FRONTEND=noninteractive apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade || ok=no
      systemctl restart arcade-launcher; systemctl restart --no-block arcade-kiosk
      [ "$ok" = yes ] && ! healthy && ok=unhealthy
    fi
  fi
  # Only apt.lock's holds were added here; the boot packages stay held.
  for p in "${locked[@]}"; do echo "$held_now" | grep -qx "$p" || apt-mark unhold "$p" >/dev/null 2>&1; done
  changed=${#plan[@]}
  case "$ok" in
    yes)
      [ "$changed" = 0 ] || state_write "$STATE/os-watch" "payload=$PAYLOAD" "saved=$PAYLOAD/os-before"
      OS_REPORT="{\"changed\":$changed}" ;;
    space|save)
      OS_REPORT="{\"changed\":0,\"note\":\"$ok\"}"
      data_check
      finish false "the software updated, but the OS packages weren't touched: $( [ "$ok" = space ] && echo 'under 2 GB free' || echo "couldn't keep a copy of them first")" ;;
    *)
      ROLLED_BACK=true
      apt_back "$PAYLOAD/os-before"
      systemctl daemon-reload
      systemctl restart arcade-launcher; systemctl restart --no-block arcade-kiosk
      service_up && ACTIVE=true || ACTIVE=false
      OS_REPORT="{\"changed\":0,\"rolled_back\":$changed}"
      after=""
      # The network back too (D333): its service again, and if that isn't enough, a restart on the old packages.
      if [ "$NET_BEFORE" = yes ] && ! net_ok 5; then
        systemctl restart NetworkManager 2>/dev/null
        if ! net_ok 30; then
          after=" The network didn't come back by itself, so the cabinet restarts in 15 s."
          systemd-run --quiet --on-active=15 /usr/bin/systemctl reboot
        fi
      fi
      data_check
      finish false "the OS packages broke the cabinet ($ok), so all $changed were put back as they were; the software update stayed.$after"
      ;;
  esac
fi

data_check
[ "$(config_print)" = "$CONFIG_BEFORE" ] || finish false "the config changed"
[ "$DATA_KEPT" = true ] || finish false "the cabinet's data changed: see data in this result"
finish true "updated"

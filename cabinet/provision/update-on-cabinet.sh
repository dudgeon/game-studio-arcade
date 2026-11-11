#!/bin/bash
# Runs on the cabinet, as root, in its own systemd unit, so a dropped SSH connection can't stop it halfway
# (D195). Started by scripts/virtual-cabinet/update-cabinet.mjs with a payload folder that holds bundle.tar.gz,
# provision.tar.gz and commit. It runs the newer provisioning script over the cabinet as it stands (D4), proves
# every piece of the cabinet's data came through (D196), and writes result.json for the mini. Prints no secrets.
set -u
PAYLOAD="${1:?payload folder}"
RESULT="$PAYLOAD/result.json"
DATA=/var/lib/arcade
CONFIG=/etc/arcade/service.json
log() { echo "[update $(date -u +%H:%M:%S)] $*"; }
exec >> "$PAYLOAD/update.log" 2>&1

[ ! -e "$RESULT" ] || { log "already ran"; exit 0; }
[ ! -e "$PAYLOAD/started" ] || { log "already started"; exit 0; }
: > "$PAYLOAD/started"

DATA_KEPT=false
DATA_REPORT=null
ROLLED_BACK=false
ACTIVE=false

finish() { # finish OK REASON
  local temp="$RESULT.new"
  node -e '
    const [ok, reason, before, after, commit, configWas, configIs, dataKept, report, rolledBack, active] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ ok: ok === "true", reason, version_before: before, version_after: after, commit,
      config_before: configWas, config_after: configIs, data_kept: dataKept === "true", data: JSON.parse(report),
      rolled_back: rolledBack === "true", service_active: active === "true" }, null, 1) + "\n");
  ' "$1" "$2" "$BEFORE" "$(cat /etc/arcade/provisioned-version 2>/dev/null)" "$(cat "$PAYLOAD/commit" 2>/dev/null)" \
    "$CONFIG_BEFORE" "$(config_print)" "$DATA_KEPT" "$DATA_REPORT" "$ROLLED_BACK" "$ACTIVE" > "$temp"
  mv "$temp" "$RESULT"
  log "finished: ok=$1 $2"
  exit 0
}

# What the config is, without its contents: a hash, its mode and its owner.
config_print() {
  if [ -e "$CONFIG" ]; then echo "$(sha256sum "$CONFIG" | cut -c1-16) $(stat -c '%a %U' "$CONFIG")"; else echo absent; fi
}
service_up() {
  local i
  for i in $(seq 1 30); do
    if systemctl is-active --quiet arcade-launcher && node -e 'fetch("http://127.0.0.1:8330/api/config").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
# Every file under the data folder, apart from the browser's cache, against the record taken before (D196).
data_check() {
  DATA_REPORT="$(node "$PAYLOAD/check/data-check.mjs" check "$DATA" "$PAYLOAD/data.before")" && DATA_KEPT=true || DATA_KEPT=false
  [ -n "$DATA_REPORT" ] || DATA_REPORT=null
  log "data: $DATA_REPORT"
}

BEFORE="$(cat /etc/arcade/provisioned-version 2>/dev/null)"
CONFIG_BEFORE="$(config_print)"
PREVIOUS="$(readlink -f /opt/arcade/current)"

# The service writes the cabinet's data in two cases: during a make, and when it starts with sessions left to
# collect (D191). An update restarts it, so it waits for neither: nothing may change but what the update means to.
phase="$(node -e 'fetch("http://127.0.0.1:8330/api/studio").then((r) => r.json()).then((s) => console.log(s.phase), () => console.log("unknown"))' 2>/dev/null)"
left="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length) } catch { console.log(0) }' "$DATA/studio-left.json")"
if [ "$phase" = running ] || [ -e "$DATA/studio-run.json" ]; then
  ACTIVE=true; DATA_KEPT=true
  finish false "a make is running: nothing was changed"
fi
if [ "${left:-0}" != 0 ]; then
  ACTIVE=true; DATA_KEPT=true
  finish false "$left make(s) cut off by a restart are still to be collected: nothing was changed. Try again once the shelf shows how they ended"
fi

PROFILE="$(sed -n 's/^profile=//p' /etc/arcade/cabinet.conf)"
case "$PROFILE" in picade|virtual) ;; *) finish false "this cabinet doesn't say which profile it is" ;; esac

# The checker comes from this payload, so it's the one the update ships.
install -d "$PAYLOAD/check"
tar -xzf "$PAYLOAD/provision.tar.gz" -C "$PAYLOAD/check" ./data-check.mjs || finish false "couldn't unpack the data check"
node "$PAYLOAD/check/data-check.mjs" record "$DATA" "$PAYLOAD/data.before" || finish false "couldn't record the data before updating"
log "from $BEFORE, profile $PROFILE, commit $(cat "$PAYLOAD/commit")"

WORK=/opt/arcade/provision
rm -rf "$WORK.new"
install -d "$WORK.new"
if ! tar -xzf "$PAYLOAD/provision.tar.gz" -C "$WORK.new"; then finish false "couldn't unpack the provisioning script"; fi

rollback() {
  log "rolling back to $PREVIOUS"
  ln -sfn "$PREVIOUS" /opt/arcade/current
  echo "$BEFORE" > /etc/arcade/provisioned-version
  systemctl restart arcade-launcher
  systemctl restart --no-block arcade-kiosk
  ROLLED_BACK=true
}

rm -rf "$WORK"
mv "$WORK.new" "$WORK"
if ! /bin/bash "$WORK/provision.sh" --profile "$PROFILE" --payload "$PAYLOAD"; then
  rollback
  service_up && ACTIVE=true
  data_check
  finish false "the provisioning script failed: see $PAYLOAD/update.log"
fi

if service_up; then ACTIVE=true; else
  rollback
  service_up && ACTIVE=true
  data_check
  finish false "the service didn't come back on the new version"
fi

data_check
[ "$(config_print)" = "$CONFIG_BEFORE" ] || finish false "the config changed"
[ "$DATA_KEPT" = true ] || finish false "the cabinet's data changed: see data in this result"
finish true "updated"

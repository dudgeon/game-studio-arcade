#!/bin/bash
# Runs on the cabinet, as root, in its own systemd unit, so a dropped SSH connection can't stop it halfway
# (D195). Started by scripts/virtual-cabinet/update-cabinet.mjs with a payload folder that holds bundle.tar.gz,
# provision.tar.gz and commit. It runs the newer provisioning script over the cabinet as it stands (D4), checks
# that carts, logs and config came through, and writes result.json for the mini to read. Prints no secrets.
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

finish() { # finish OK REASON
  local temp="$RESULT.new"
  node -e '
    const [ok, reason, before, after, commit, configWas, configIs, cartsSame, logsKept, rolledBack, active] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ ok: ok === "true", reason, version_before: before, version_after: after, commit,
      config_before: configWas, config_after: configIs, carts_same: cartsSame === "true", logs_kept: logsKept === "true",
      rolled_back: rolledBack === "true", service_active: active === "true" }, null, 1) + "\n");
  ' "$1" "$2" "$BEFORE" "$(cat /etc/arcade/provisioned-version 2>/dev/null)" "$(cat "$PAYLOAD/commit" 2>/dev/null)" \
    "$CONFIG_BEFORE" "$(config_print)" "${CARTS_SAME:-false}" "${LOGS_KEPT:-false}" "${ROLLED_BACK:-false}" "${ACTIVE:-false}" > "$temp"
  mv "$temp" "$RESULT"
  log "finished: ok=$1 $2"
  exit 0
}

# What the config is, without its contents: a hash, its mode and its owner.
config_print() {
  if [ -e "$CONFIG" ]; then echo "$(sha256sum "$CONFIG" | cut -c1-16) $(stat -c '%a %U' "$CONFIG")"; else echo absent; fi
}
# Every cart file, by content, apart from the library's own git folder.
carts_print() { (cd "$DATA/carts" && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | cut -c1-16); }
# Logs only ever grow, so what each file held before must still be the start of it.
logs_record() {
  (cd "$DATA/logs" && for f in *; do [ -f "$f" ] && echo "$f $(stat -c %s "$f") $(sha256sum < "$f" | cut -c1-16)"; done) > "$PAYLOAD/logs.before"
}
logs_kept() {
  local f size sum
  while read -r f size sum; do
    [ "$(head -c "$size" "$DATA/logs/$f" 2>/dev/null | sha256sum | cut -c1-16)" = "$sum" ] || { log "log changed: $f"; return 1; }
  done < "$PAYLOAD/logs.before"
}
service_up() {
  local i
  for i in $(seq 1 30); do
    if systemctl is-active --quiet arcade-launcher && node -e 'fetch("http://127.0.0.1:8330/api/config").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

BEFORE="$(cat /etc/arcade/provisioned-version 2>/dev/null)"
CONFIG_BEFORE="$(config_print)"
PREVIOUS="$(readlink -f /opt/arcade/current)"

# A make in progress would be cut off, and its cart isn't committed yet. So not while one runs.
phase="$(node -e 'fetch("http://127.0.0.1:8330/api/studio").then((r) => r.json()).then((s) => console.log(s.phase), () => console.log("unknown"))' 2>/dev/null)"
if [ "$phase" = running ] || [ -e "$DATA/studio-run.json" ]; then
  ACTIVE=true; CARTS_SAME=true; LOGS_KEPT=true
  finish false "a make is running: nothing was changed"
fi

PROFILE="$(sed -n 's/^profile=//p' /etc/arcade/cabinet.conf)"
case "$PROFILE" in picade|virtual) ;; *) finish false "this cabinet doesn't say which profile it is" ;; esac

CARTS_BEFORE="$(carts_print)"
logs_record
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
  [ "$(carts_print)" = "$CARTS_BEFORE" ] && CARTS_SAME=true
  logs_kept && LOGS_KEPT=true
  finish false "the provisioning script failed: see $PAYLOAD/update.log"
fi

if service_up; then ACTIVE=true; else
  rollback
  service_up && ACTIVE=true
  [ "$(carts_print)" = "$CARTS_BEFORE" ] && CARTS_SAME=true
  logs_kept && LOGS_KEPT=true
  finish false "the service didn't come back on the new version"
fi

CARTS_NOW="$(carts_print)"
[ "$CARTS_NOW" = "$CARTS_BEFORE" ] && CARTS_SAME=true || log "carts changed: was $CARTS_BEFORE, now $CARTS_NOW"
logs_kept && LOGS_KEPT=true
[ "$(config_print)" = "$CONFIG_BEFORE" ] || finish false "the config changed"
[ "${CARTS_SAME:-false}" = true ] || finish false "the carts changed"
[ "${LOGS_KEPT:-false}" = true ] || finish false "a log changed"
finish true "updated"

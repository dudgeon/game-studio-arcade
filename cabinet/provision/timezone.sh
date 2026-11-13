# Sourced by provision.sh, for both profiles (D246). The cabinet keeps the family's time zone, the mini's, sent
# as "timezone" in every payload: a build's seed, the Picade's card seed, and each in-place update. Its dates and
# the coin pot's month (D202: "on the 1st, cabinet local time") follow it. No file, or a name this system has no
# zone for, leaves the zone as it is. The service and kiosk restart after this step, so they read the new zone.
ZONEINFO="${ZONEINFO:-/usr/share/zoneinfo}"
ETC_DIR="${ETC_DIR:-/etc}"

step_timezone() {
  local tz now
  [ -f "$PAYLOAD/timezone" ] || { log "no time zone in the payload: keeping $(cat "$ETC_DIR/timezone" 2>/dev/null)"; return 0; }
  tz="$(head -1 "$PAYLOAD/timezone" | tr -d '[:space:]')"
  if ! [[ "$tz" =~ ^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$ ]] || [ ! -f "$ZONEINFO/$tz" ]; then
    log "unknown time zone '$tz': keeping the cabinet's"
    return 0
  fi
  now="$(readlink "$ETC_DIR/localtime" 2>/dev/null || true)"
  if [ "$now" = "$ZONEINFO/$tz" ] && [ "$(cat "$ETC_DIR/timezone" 2>/dev/null)" = "$tz" ]; then return 0; fi
  ln -sfn "$ZONEINFO/$tz" "$ETC_DIR/localtime"
  echo "$tz" > "$ETC_DIR/timezone"
  log "time zone set to $tz (was ${now#"$ZONEINFO/"})"
}

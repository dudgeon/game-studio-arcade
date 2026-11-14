# Sourced by provision.sh, for both profiles (D322). A card written by flash.mjs carries seed/cabinet-config.json:
# the cabinet's own Anthropic key and agent ids, and the Groq key (D320, D321). This puts it into the service's
# config (/etc/arcade/service.json, owner arcade, mode 0600) with the same tool connect-cabinet.sh uses, then
# overwrites it on the card with zeros and removes it, whatever happened. Never prints it.
# ARCADE_ETC and ARCADE_DATA are service-config.mjs's own; CONFIG_INSTALL is for the test.
step_cabinet_config() {
  local f="$PAYLOAD/cabinet-config.json" etc="${ARCADE_ETC:-/etc/arcade}" err why
  [ -f "$f" ] || return 0
  if [ -f "$etc/service.json" ]; then
    log "the card carries a cabinet config, but this cabinet already has one: keeping it (connect-picade.sh changes it)"
  else
    # This runs before step_services makes /etc/arcade (the 2026-11-13 rehearsal: service-config.mjs had nowhere
    # to write, and the cabinet came up offline).
    install -d -m 0755 "$etc"
    err="$(mktemp)"
    if ARCADE_NO_RESTART=1 ${CONFIG_INSTALL:-/usr/local/bin/node $ARCADE_HOME/current/cabinet/vm/guest/service-config.mjs install} < "$f" > /dev/null 2> "$err"; then
      log "connected: the card's key, agent and Groq key are in service.json (D322)"
    else
      # service-config.mjs never quotes the config; a crash's own "Error: ..." line says more than its last line.
      why="$(grep -m1 -E '^[A-Za-z]*Error|^The ' "$err" || tail -1 "$err")"
      log "the card's cabinet config didn't install (${why}): the cabinet starts offline"
    fi
    rm -f "$err"
  fi
  wipe_secret "$f"
}

# Overwrite in place, then remove. On an SD card the controller may still hold old blocks: the card stays Geoff's.
wipe_secret() {
  local n
  n="$(wc -c < "$1" | tr -d ' ')"
  [ "${n:-0}" -gt 0 ] && dd if=/dev/zero of="$1" bs="$n" count=1 conv=notrunc 2>/dev/null
  sync
  rm -f "$1"
  sync
  log "wiped the cabinet config from the card"
}

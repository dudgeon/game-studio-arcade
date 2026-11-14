# Sourced by provision.sh, for both profiles (D324). A card written by flash.mjs carries seed/twin-data.tar.gz: the
# virtual cabinet's games, makers, coin ledger and logs at flash time, taken with the twin's own seed rules (D291,
# D292: never keys, the config or the Manager token). On a cabinet whose data folder is still empty, this unpacks
# it there before the starter games, so the Picade starts as a copy of the twin (D295). Never over existing data.
# The tarball stays on the card: it's a copy, and nothing is deleted (D5). DATA_OWNER is for the test.
step_twin_data() {
  local t="$PAYLOAD/twin-data.tar.gz" carts
  [ -f "$t" ] || return 0
  if [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
    log "the card carries the twin's data, but this cabinet already has data: keeping its own (twin.mjs sync follows it)"
    return 0
  fi
  install -d "$DATA"
  tar -xzf "$t" -C "$DATA" --no-same-owner
  ${DATA_OWNER:-chown -R arcade:arcade} "$DATA"
  carts="$(find "$DATA/carts" -mindepth 2 -maxdepth 2 -name cart.json 2>/dev/null | wc -l | tr -d ' ')"
  log "the twin's data is here (D324): ${carts} games, with their makers, coin history and logs"
}

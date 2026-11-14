# Sourced by provision.sh, for both profiles (D370). On a cabinet with no cart library yet (a card flashed without
# the twin's data), this starts the library exactly as the service's ensureLibrary does (studio-kit/cli/src/library.js:
# the same README, author and first commit), then commits each starter step_carts copied in, as its version 1. So the
# starters have a history from the first boot, not only made games. A library that's already there (a seeded card,
# the twin's) is left exactly as it is. GIT_AS is for the test.
STARTER_IDS="${STARTER_IDS:-}"

lib_git() {
  ${GIT_AS:-runuser -u arcade --} env GIT_AUTHOR_NAME=Studio GIT_AUTHOR_EMAIL=studio@game-studio-arcade.invalid \
    GIT_COMMITTER_NAME=Studio GIT_COMMITTER_EMAIL=studio@game-studio-arcade.invalid git -C "$DATA/carts" "$@"
}

step_library() {
  local id n=0
  [ -d "$DATA/carts" ] || return 0
  if [ -e "$DATA/carts/.git" ]; then
    log "the cart library is already there: leaving it as it is"
    return 0
  fi
  lib_git init -q -b main
  printf '# Dev cart library\n\nOne folder per cart. Never delete; every version is a commit.\n' > "$DATA/carts/README.md"
  ${DATA_OWNER_FILE:-chown arcade:arcade} "$DATA/carts/README.md"
  lib_git add README.md
  lib_git commit -q -m "Start the dev cart library"
  for id in $STARTER_IDS; do
    [ -f "$DATA/carts/$id/cart.json" ] || continue
    lib_git add -- "$id"
    lib_git commit -q -m "starter $id v1 (D161)"
    n=$((n + 1))
  done
  log "started the cart library: ${n} starters committed (D370)"
}

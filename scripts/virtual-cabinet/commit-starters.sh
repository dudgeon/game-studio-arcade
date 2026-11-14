#!/bin/bash
# Commits the virtual cabinet's untracked starter carts (apple-catch, comet-dodge, wall-ball) into its cart library,
# the way first boot now does on a new card (D390, D391): one commit each, "starter <id> v1 (D161)", by "Studio".
# So a card seeded from the twin carries the starters' history too. It only adds commits: nothing is changed,
# moved or deleted, and a starter that's already tracked is left alone, so running it again does nothing.
#
#   scripts/virtual-cabinet/commit-starters.sh             commit what's untracked
#   scripts/virtual-cabinet/commit-starters.sh --dry-run   say what it would commit, and change nothing
#
# It refuses while a make is running or still to be collected: the service commits to the same library.
# Run it before the flash: a commit on the twin after the Picade exists is the twin's own, set aside by sync (D294).
# ARCADE_DRIVE (a stand-in) and COMMIT_STARTERS_LOCAL=DIR (a data folder here, for the test) are for its test.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DRIVE="${ARCADE_DRIVE:-$REPO/cabinet/vm/drive}"
DRY=no
case "${1:-}" in
  "") ;;
  --dry-run) DRY=yes ;;
  *) echo "the only option is --dry-run" >&2; exit 2 ;;
esac

# Runs on the cabinet as arcade (or here, for the test). $1: the data folder; $2: yes for a dry run.
BODY='set -euo pipefail
DATA="$1"; DRY="$2"
cd "$DATA/carts" 2>/dev/null || { echo "Stopped: no cart library at $DATA/carts"; exit 3; }
[ -d .git ] || { echo "Stopped: $DATA/carts isn'"'"'t a git library yet"; exit 3; }
if [ -e "$DATA/studio-run.json" ] || { [ -f "$DATA/studio-left.json" ] && [ "$(tr -d "[:space:][]" < "$DATA/studio-left.json")" != "" ]; }; then
  echo "Stopped: a make is running or still to be collected; run this once it is done"; exit 4
fi
export GIT_AUTHOR_NAME=Studio GIT_AUTHOR_EMAIL=studio@game-studio-arcade.invalid GIT_COMMITTER_NAME=Studio GIT_COMMITTER_EMAIL=studio@game-studio-arcade.invalid
n=0
for id in apple-catch comet-dodge wall-ball; do
  [ -f "$id/cart.json" ] || { echo "  $id: not here"; continue; }
  if [ -n "$(git ls-files -- "$id" | head -1)" ]; then echo "  $id: already in the library"; continue; fi
  if [ "$DRY" = yes ]; then echo "  $id: would commit"; n=$((n + 1)); continue; fi
  git add -- "$id"
  git commit -q -m "starter $id v1 (D161)"
  echo "  $id: committed $(git rev-parse --short HEAD)"
  n=$((n + 1))
done
echo "$([ "$DRY" = yes ] && echo "would commit" || echo "committed") $n starters; untracked now: $(git status --porcelain | wc -l | tr -d " ")"'

if [ -n "${COMMIT_STARTERS_LOCAL:-}" ]; then
  exec /bin/bash -c "$BODY" body "$COMMIT_STARTERS_LOCAL" "$DRY"
fi
printf '%s' "$BODY" | "$DRIVE" ssh "sudo -u arcade bash -s -- /var/lib/arcade $DRY"

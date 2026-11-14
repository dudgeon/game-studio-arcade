#!/bin/bash
# cx-audit: run one flow against a local replaying service, in headless Chromium, with a fresh copy of the
# day-one-like data (three starters, two example games, the two guests). Nothing here touches a cabinet.
#   docs/cx-audit/flows/run.sh NAME [extra drive.js flags]      shots land in $OUT/NAME (default /tmp/cx-audit)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
NAME="$1"; shift
OUT="${OUT:-/tmp/cx-audit}"; DATA="$OUT/data-$NAME"
rm -rf "$DATA" "$OUT/$NAME"; mkdir -p "$DATA/carts"
K="$REPO/studio-kit"
cp -R "$K/context-pack/templates/catch" "$DATA/carts/apple-catch"
cp -R "$K/context-pack/templates/dodge" "$DATA/carts/comet-dodge"
cp -R "$K/context-pack/templates/paddle" "$DATA/carts/wall-ball"
cp -R "$K/playtest/test/fixtures/candy-cat-drop" "$DATA/carts/candy-cat-drop"
cp -R "$K/cli/fixtures/log-hopper/cart" "$DATA/carts/log-hopper"
cd "$REPO/cabinet/service"
node scripts/drive.js --script "$HERE/$NAME.drive" --out "$OUT/$NAME" --data "$DATA" --replay "$K/cli/fixtures/penguin-catch" --pace 20 "$@"

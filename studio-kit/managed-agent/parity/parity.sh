#!/usr/bin/env bash
# Runs inside a Studio sandbox session (task 7 accept, D62 parity check).
# Extracts the studio kit, playtests the dot-catch fixture with both drivers,
# and writes the reports flat to /mnt/session/outputs/, DONE.json last (D19).
# Also runs on the mini with KIT_TGZ/OUT/WORK set, to make the local half.
set -u
KIT_TGZ="${KIT_TGZ:-/mnt/session/uploads/studio-kit.tgz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-/workspace/parity}"
OUT="${OUT:-/mnt/session/outputs}"
mkdir -p "$WORK/kit" "$OUT"
tar -xzf "$KIT_TGZ" -C "$WORK/kit"
cd "$WORK/kit"
: > "$WORK/exits.txt"
for d in node browser; do
  rm -rf "$WORK/dc-$d" "$WORK/out-$d"
  cp -r "$HERE/dot-catch" "$WORK/dc-$d"
  NODE_PATH="$(npm root -g)" node studio-kit/playtest/bin/gsa-playtest.js "$WORK/dc-$d" \
    --driver "$d" --out "$WORK/out-$d" > "$WORK/playtest-$d.log" 2>&1
  echo "$d $?" >> "$WORK/exits.txt"
  cp "$WORK/out-$d/playtest.json" "$OUT/playtest-$d.json" 2>/dev/null || true
  cp "$WORK/playtest-$d.log" "$OUT/playtest-$d.log"
done
cp "$WORK/exits.txt" "$OUT/exits.txt"
node -e '
  const fs = require("fs"), path = require("path");
  const out = process.argv[1];
  const files = fs.readdirSync(out).filter((n) => n !== "DONE.json")
    .map((name) => ({ name, size: fs.statSync(path.join(out, name)).size }));
  fs.writeFileSync(path.join(out, "DONE.json"), JSON.stringify({ files }));
' "$OUT"
cat "$WORK/exits.txt"

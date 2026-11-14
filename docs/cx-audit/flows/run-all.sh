#!/bin/bash
# cx-audit: run the named flows (default: all), then a contact sheet for each. Logs beside the shots.
#   OUT=/tmp/cx-audit docs/cx-audit/flows/run-all.sh [NAME ...]
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
export OUT="${OUT:-/tmp/cx-audit}"
mkdir -p "$OUT"
[ $# -gt 0 ] || set -- $(cd "$HERE" && ls *.drive | sed 's/\.drive$//')
for f in "$@"; do
  "$HERE/run.sh" "$f" > "$OUT/$f.log" 2>&1
  echo "$f: exit $?"
  tail -n 12 "$OUT/$f.log" | grep -v "^  \(press\|wait\|shot\|sleep\|hold\|down\|up\|say\) "
  node "$HERE/../../../cabinet/service/scripts/contact-sheet.js" "$OUT/$f" "${PER:-12}" > /dev/null 2>&1
done

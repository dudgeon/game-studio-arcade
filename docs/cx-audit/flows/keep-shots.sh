#!/bin/bash
# cx-audit: copy the captures the report shows from a run's output into docs/cx-audit/shots.
#   OUT=/tmp/cx-audit docs/cx-audit/flows/keep-shots.sh
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-/tmp/cx-audit}"
S="$HERE/../shots"
mkdir -p "$S"
keep() { # FLOW "NN NN ..."
  for n in $2; do
    for f in "$OUT/$1/$n"-*.png; do
      [ -f "$f" ] && cp "$f" "$S/$1-$(basename "$f" | cut -c4-)"
    done
  done
}
keep names "03 04 05 07 09 10 11 12"
keep make-edges "05 06 07 10 13"
keep wifi "02 03 05 07 10 11 12"
keep games "02 05 18"
keep teti "01 04 08 16 17"
keep first-switch-on "01 05 10"
keep redirect-restart "01 05"
keep two-players "04"
ls "$S" | wc -l

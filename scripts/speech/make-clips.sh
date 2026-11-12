#!/bin/bash
# Test clips for speech (D265): each phrase in phrases.txt, spoken by macOS voices, as 16 kHz mono 16-bit
# WAVs with the words in a .txt beside each. Clips aren't committed; make them where you need them.
#
#   scripts/speech/make-clips.sh OUT_DIR [VOICE...]
#
# Default voices: Samantha and Daniel (natural), Flo and Junior (synthetic, harder).
set -euo pipefail
OUT="${1:?usage: make-clips.sh OUT_DIR [VOICE...]}"
shift
[ $# -gt 0 ] || set -- Samantha "Daniel (English (UK))" "Flo (English (US))" Junior
mkdir -p "$OUT"
i=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  i=$((i + 1))
  for v in "$@"; do
    tag="$(printf '%s' "${v%% *}" | tr 'A-Z' 'a-z')"
    say -v "$v" -o "$OUT/$tag-$i.wav" --data-format=LEI16@16000 "$line"
    printf '%s\n' "$line" > "$OUT/$tag-$i.txt"
  done
done < "$(dirname "$0")/phrases.txt"
echo "$i phrases x $# voices in $OUT"

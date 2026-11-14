#!/bin/bash
# cx-audit: writes games.drive, the same steps for each house game on the shelf, top to bottom.
cd "$(dirname "$0")"
{
  echo "# cx-audit: every house game on the day-one-like shelf: start, play, try START and the spare keys, leave."
  echo "# Written by make-games-flow.sh."
  echo "#seed family.json"
  echo "wait S1"
  for g in candy-cat-drop log-hopper apple-catch comet-dodge wall-ball; do
    cat <<EOF
press down
press a
wait G0
shot $g-G0
press a
wait play
sleep 1500
shot $g-title
press start
sleep 700
shot $g-after-start
hold left 500
press a
hold right 700
press b
hold up 300
shot $g-playing
press start
sleep 600
shot $g-start-again
press f1
press f2
press q
press e
sleep 300
shot $g-after-ENT-COIN-pinks
sleep 6000
shot $g-left-alone
press esc
sleep 900
shot $g-after-esc
press esc
sleep 700
press esc
wait S1
EOF
  done
  echo "shot shelf-after-plays"
} > games.drive

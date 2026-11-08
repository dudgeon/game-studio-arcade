#!/usr/bin/env bash
# Build the same request on several models, one at a time, with recorded answers
# and the brief in the repo. A model that hits its cap gets no more runs.
#
#   compare-models.sh <answers.json> <log-dir> <budget-cents> <model> [<model> ...]
#
# Run ids are printed as "RUN <n> <model> <session> <stop_reason> <outcome> <cents>".
set -u
ANSWERS="$1"; LOGS="$2"; BUDGET="$3"; shift 3
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
DATA="${GSA_DATA_DIR:-$HOME/game-studio-data}"
mkdir -p "$LOGS"
capped=" "
n=0
for model in "$@"; do
  n=$((n + 1))
  case "$capped" in *" $model "*) echo "RUN $n $model skipped: hit its cap earlier"; continue ;; esac
  "$NODE" "$HERE/../bin/studio.js" make --answers "$ANSWERS" --model "$model" --budget-cents "$BUDGET" --brief-from-file -v \
    > "$LOGS/run-$n-$model.log" 2>&1 < /dev/null
  rc=$?
  line="$("$NODE" -e '
    const fs = require("fs");
    const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const r = JSON.parse(rows.at(-1));
    console.log([r.id, r.stop_reason, r.outcome, r.list_cost && r.list_cost.amount].join(" "));
  ' "$DATA/logs/studio_session.jsonl")"
  echo "RUN $n $model rc=$rc $line"
  case "$line" in *budget_reached*) capped="$capped$model " ;; esac
done
echo "ALL DONE"

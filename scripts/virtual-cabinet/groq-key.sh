#!/bin/bash
# Turns Groq on for a cabinet's speech (D263): puts a Groq API key in the cabinet's config, owned by
# `arcade`, mode 0600. With a key, Groq transcribes first and Moonshine on the cabinet answers whenever
# Groq can't (offline, an error, a rate limit, more than about 3 seconds). Without one, Moonshine does it all.
#
# Before the first kid's voice goes to Groq: turn on Zero Data Retention for the Groq organization at
# console.groq.com/settings/data-controls (docs/speech.md). This script asks first.
#
# Run it yourself, in a Terminal window on the mini (not with Claude Code's `!`):
#
#   scripts/virtual-cabinet/groq-key.sh          asks for the key, with no echo
#   scripts/virtual-cabinet/groq-key.sh --off    takes the key off the cabinet; Moonshine carries on
#
# The key is only ever in this script's memory and on two pipes (to curl and over SSH). It is never an
# argument, an environment variable, a file on the mini, or a log line.
#
# ARCADE_HOST picks another cabinet. ARCADE_DRIVE, GROQ_CHECK_URL and ARCADE_CONNECT_* are for its test.
set -euo pipefail
set +x
ulimit -c 0

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
DRIVE="${ARCADE_DRIVE:-$REPO/cabinet/vm/drive}"
GUEST=/opt/arcade/current/cabinet/vm/guest/service-config.mjs
CHECK_URL="${GROQ_CHECK_URL:-https://api.groq.com/openai/v1/models}"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"

key=""
trap 'key=""' EXIT
stop() { echo "Stopped: $*" >&2; exit 1; }

export ARCADE_SSH_TIMEOUT_S="${ARCADE_SSH_TIMEOUT_S:-120}"
# Into the cabinet over SSH's stdin, waiting out a gap (D156). Installing twice is harmless.
send() { # send JSON
  local rc i
  for i in $(seq 1 "${ARCADE_CONNECT_TRIES:-60}"); do
    set +e
    printf '%s' "$1" | "$DRIVE" ssh sudo node "$GUEST" groq 2>"$VM_ROOT/.groq.err"
    rc="${PIPESTATUS[1]}"
    set -e
    [ "$rc" = 255 ] || break
    [ "$i" = 1 ] && echo "Waiting for the cabinet to answer..." >&2
    sleep "${ARCADE_CONNECT_WAIT_S:-5}"
  done
  if [ "$rc" != 0 ]; then
    reason="$(grep -v -E 'Please note|rptl|^$' "$VM_ROOT/.groq.err" | tail -1 || true)"
    rm -f "$VM_ROOT/.groq.err"
    stop "the cabinet didn't take it: ${reason:-ssh exited $rc}"
  fi
  rm -f "$VM_ROOT/.groq.err"
}

case "${1:-}" in
  "") ;;
  --off)
    send '{"groq_api_key":""}'
    exit 0
    ;;
  *) stop "the only option is --off. The key is never an argument." ;;
esac

[ -t 0 ] && [ -t 1 ] || stop "run this in a Terminal window on the mini, so the key can't land in a chat or a log."

printf 'Is Zero Data Retention on for your Groq organization (console.groq.com/settings/data-controls)? (y/n) ' >/dev/tty
IFS= read -r answer </dev/tty
case "$answer" in y|Y|yes) ;; *) stop "turn it on first, so the kids' voices aren't kept for abuse monitoring (docs/speech.md)." ;; esac

printf "Paste the Groq API key, then press Return (nothing will show): " >/dev/tty
IFS= read -rs key </dev/tty
printf '\n' >/dev/tty
case "$key" in
  gsk_*) ;;
  *) stop "that doesn't look like a Groq API key (they start gsk_)." ;;
esac
case "$key" in
  *[!A-Za-z0-9_]*) stop "the key has a character keys don't have. Check that it pasted cleanly." ;;
esac

# A free read with the key, on stdin as a header, to catch a bad paste before the cabinet gets it.
status="$(printf 'Authorization: Bearer %s\n' "$key" | curl -sS -m 30 -o /dev/null -w '%{http_code}' -H @- "$CHECK_URL")" || stop "couldn't reach Groq."
case "$status" in
  200) ;;
  401) stop "Groq refused this key. Check it wasn't cut short when pasted." ;;
  *) stop "Groq answered $status when checking the key." ;;
esac

send "{\"groq_api_key\":\"$key\"}"

if [ "$(pbpaste 2>/dev/null || true)" = "$key" ]; then
  printf '' | pbcopy
  echo "Cleared the key from the clipboard."
fi
key=""
echo "Done. Hold a button and speak: the cabinet's speech log (speech.jsonl) shows which engine answered."

#!/bin/bash
# Connects a cabinet to its own workspace (D131, D185, D155): applies the Studio agent there and
# puts the key in the cabinet's config, owned by `arcade`, mode 0600. Nothing is spent until
# someone picks Make on the cabinet.
#
# Run it yourself, in a Terminal window on the mini (not with Claude Code's `!`):
#
#   scripts/virtual-cabinet/connect-cabinet.sh             asks for the key, with no echo
#   scripts/virtual-cabinet/connect-cabinet.sh --reapply   after the Studio agent changes: reuses
#                                                          the key already on the cabinet
#
# The key is only ever in this script's memory and on two pipes (to `ant` and over SSH). It is
# never an argument, an environment variable, a file on the mini, or a log line.
#
# ARCADE_HOST and CABINET pick another cabinet: CABINET names its lock file, default arcade-virtual.
# ARCADE_DRIVE, ARCADE_AGENT_DIR and GSA_NODE are for its test (test/connect.test.mjs).
set -euo pipefail
set +x
ulimit -c 0

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_DIR="${ARCADE_AGENT_DIR:-$REPO/studio-kit/managed-agent}"
CABINET="${CABINET:-arcade-virtual}"
LOCK="claude-lock.$CABINET.json"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
DRIVE="${ARCADE_DRIVE:-$REPO/cabinet/vm/drive}"
GUEST=/opt/arcade/current/cabinet/vm/guest/service-config.mjs
NODE="${GSA_NODE:-/opt/homebrew/opt/node@22/bin/node}"
[ -f "$VM_ROOT/host" ] && export ARCADE_HOST="${ARCADE_HOST:-$(cat "$VM_ROOT/host")}"

key=""
trap 'key=""' EXIT
stop() { echo "Stopped: $*" >&2; exit 1; }

REAPPLY=no
case "${1:-}" in
  "") ;;
  --reapply) REAPPLY=yes ;;
  *) stop "the only option is --reapply. The key is never an argument." ;;
esac

# D16: the mini must never have these set. They'd also outrank what this script is doing.
[ -z "${ANTHROPIC_API_KEY+x}" ] || stop "ANTHROPIC_API_KEY is set in this shell. It must never be set on the mini (D16). Unset it, and remove it from your shell profile."
[ -z "${ANTHROPIC_AUTH_TOKEN+x}" ] || stop "ANTHROPIC_AUTH_TOKEN is set in this shell. Unset it first."
command -v ant >/dev/null || stop "the ant CLI is missing: brew install anthropics/tap/ant"
[ -x "$NODE" ] || stop "Node 22 is missing at $NODE"

# 1. The cabinet: reachable, and with no replay data that could move to the Picade (D150).
if ! state="$("$DRIVE" ssh sudo node "$GUEST" check 2>"$VM_ROOT/.connect-check.err")"; then
  reason="$(grep -v -E 'Please note|rptl|^$' "$VM_ROOT/.connect-check.err" | tail -1 || true)"
  rm -f "$VM_ROOT/.connect-check.err"
  case "$reason" in
    *"replay data"*) stop "$reason Clear it first with: scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm" ;;
    *) stop "can't reach the cabinet at ${ARCADE_HOST:-arcade-virtual.local}: $reason. Is it running? scripts/virtual-cabinet/up.sh" ;;
  esac
fi
rm -f "$VM_ROOT/.connect-check.err"

# 2. The key: from the keyboard with no echo, or from the cabinet. Never from stdin of a pipeline.
if [ "$REAPPLY" = yes ]; then
  [ "$state" = live ] || stop "this cabinet has no key yet. Run this without --reapply."
  key="$("$DRIVE" ssh sudo node "$GUEST" key 2>/dev/null)" || stop "couldn't read the key from the cabinet."
else
  [ -t 0 ] && [ -t 1 ] || stop "run this in a Terminal window on the mini, so the key can't land in a chat or a log."
  printf "Paste the cabinet's API key, then press Return (nothing will show): " >/dev/tty
  IFS= read -rs key </dev/tty
  printf '\n' >/dev/tty
fi
case "$key" in
  sk-ant-admin*) stop "that's an Admin key. Use a key for the cabinet's workspace." ;;
  sk-ant-*) ;;
  *) stop "that doesn't look like an API key (they start sk-ant-)." ;;
esac
case "$key" in
  *[!A-Za-z0-9_-]*) stop "the key has a character keys don't have. Check that it pasted cleanly." ;;
esac

# 3. Which workspace is this key for? Must not be the mini's. A free read, with the key on stdin.
headers="$(printf 'x-api-key: %s\n' "$key" | curl -sS -m 30 -o /dev/null -D - -H @- -H 'anthropic-version: 2026-10-21' 'https://api.anthropic.com/v1/models?limit=1')" || stop "couldn't reach the API."
status="$(printf '%s\n' "$headers" | sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p')"
workspace="$(printf '%s\n' "$headers" | tr -d '\r' | sed -n 's/^[Aa]nthropic-[Ww]orkspace-[Ii]d: *//p' | head -1)"
case "$status" in
  200) ;;
  400) stop "this key isn't scoped to a workspace. Make one scoped to the cabinet's workspace (cabinet/README.md)." ;;
  401) stop "the API refused this key. Check it wasn't expired or cut short when pasted." ;;
  *) stop "the API answered $status when checking the key." ;;
esac
[ -n "$workspace" ] || stop "the API didn't say which workspace this key is for."
mini_workspace="$("$NODE" -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).origin.workspace_id' "$AGENT_DIR/claude-lock.json")"
[ "$workspace" != "$mini_workspace" ] || stop "this key is for the mini's own workspace ($workspace). A cabinet needs a key for its own workspace (D131)."
echo "This key is for workspace $workspace."

# 4. The plan, then the apply, in that workspace, with this cabinet's own lock file (D155).
cd "$AGENT_DIR"
if [ -f "$LOCK" ]; then targets=(); else targets=(agents/studio.md environments/studio.yaml); fi
apply() { printf '%s' "$key" | ant --api-key-stdin apply --lock-file "$LOCK" "$@" ${targets[@]+"${targets[@]}"}; }
apply --dry-run || stop "ant couldn't make a plan."
printf '\nApply this plan to workspace %s? It costs nothing. (y/n) ' "$workspace" >/dev/tty
IFS= read -r answer </dev/tty
case "$answer" in y|Y|yes) ;; *) stop "nothing applied, and nothing changed on the cabinet." ;; esac
apply --yes || stop "ant apply failed. Anything it did create is recorded in $AGENT_DIR/$LOCK, so run this again."

# 5. What the apply made, read from the lock file. These ids aren't secrets; the lock file gets committed.
read_lock() {
  "$NODE" -e '
    const lock = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const of = (kind) => Object.values(lock.resources).find((r) => r.kind === kind);
    const a = of("agent"), e = of("environment");
    if (!a || !e) process.exit(1);
    console.log([lock.origin.workspace_id, a.id, Number(a.version), e.id].join(" "));
  ' "$LOCK"
}
ids="$(read_lock)" || stop "$LOCK doesn't list an agent and an environment."
read -r lock_workspace agent_id agent_version environment_id <<<"$ids"
[ "$lock_workspace" = "$workspace" ] || stop "$LOCK is for $lock_workspace, but the key is for $workspace."

# 6. Into the cabinet, over SSH's stdin.
printf '{"anthropic_api_key":"%s","agent_id":"%s","agent_version":%s,"environment_id":"%s"}' "$key" "$agent_id" "$agent_version" "$environment_id" \
  | "$DRIVE" ssh sudo node "$GUEST" install 2>/dev/null || stop "couldn't write the cabinet's config."

# 7. A pasted key shouldn't stay on the clipboard.
if [ "$REAPPLY" = no ] && [ "$(pbpaste 2>/dev/null || true)" = "$key" ]; then
  printf '' | pbcopy
  echo "Cleared the key from the clipboard."
fi
key=""

sleep 3
active="$("$DRIVE" ssh systemctl is-active arcade-launcher 2>/dev/null || true)"
[ "$active" = active ] || stop "the cabinet service didn't come back up. On the cabinet: sudo journalctl -u arcade-launcher -n 20"
echo
echo "Done. The cabinet is live in workspace $workspace, with agent $agent_id version $agent_version."
echo "Nothing is spent until someone picks Make. Commit the lock file; it holds no secrets:"
echo "  studio-kit/managed-agent/$LOCK"

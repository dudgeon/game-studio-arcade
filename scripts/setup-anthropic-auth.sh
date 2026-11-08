#!/usr/bin/env bash
# Sign this machine in to the Claude API for game-studio-arcade (D15).
#
# Uses the ant CLI's browser sign-in, bound to the game-studio-arcade
# workspace. No API key is created or pasted. The token refreshes itself and
# lives in ~/.config/anthropic/credentials/ (mode 0600). The SDKs and the CLI
# pick it up through the active profile.
#
# Workload Identity Federation would be preferable for unattended machines,
# but it needs a Console *organization* account; Individual accounts don't
# have it. scripts/wif/ holds the WIF tooling for if the account is converted.
#
# Usage:  scripts/setup-anthropic-auth.sh
# Env:    GSA_PROFILE (default game-studio-arcade)
#         GSA_WORKSPACE_ID=wrkspc_…  skip the workspace picker

set -euo pipefail
PROFILE="${GSA_PROFILE:-game-studio-arcade}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

command -v ant >/dev/null || { err "The ant CLI is missing: brew install anthropics/tap/ant"; exit 1; }

for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do
  if [[ -n "${!v+x}" ]]; then
    warn "$v is set in your shell and overrides the sign-in. Remove it from your shell profile."
  fi
done
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

signed_in() { ant --profile "$PROFILE" models list --limit 1 >/dev/null 2>&1; }

if signed_in; then
  ok "Already signed in (profile $PROFILE)."
else
  echo "A browser window will open. Approve it and choose the game-studio-arcade"
  echo "workspace. If the page shows a code, paste it here."
  if [[ -n "${GSA_WORKSPACE_ID:-}" ]]; then
    ant auth login --profile "$PROFILE" --workspace-id "$GSA_WORKSPACE_ID"
  else
    ant auth login --profile "$PROFILE"
  fi
fi
ant profile activate "$PROFILE" >/dev/null

WS="$(ant auth status 2>/dev/null | sed -n 's/.*Workspace  *\(wrkspc_[A-Za-z0-9]*\) *(\(.*\)).*/\1 \2/p' | head -1)"
[[ -n "$WS" ]] && ok "Workspace: $WS"
case "$WS" in *game-studio-arcade*) ;; *) warn "Not bound to the game-studio-arcade workspace. Rerun with GSA_WORKSPACE_ID=<its wrkspc_ id>.";; esac

if ant models list --limit 1 >/dev/null 2>&1; then ok "Claude API works."; else err "Claude API call failed."; exit 1; fi
if ant beta:agents list --limit 1 >/dev/null 2>&1; then ok "Managed Agents works."; else err "Managed Agents call failed."; exit 1; fi
echo "Done."

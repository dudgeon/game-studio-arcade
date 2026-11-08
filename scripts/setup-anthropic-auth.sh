#!/usr/bin/env bash
# Connect this machine to the Claude API with Workload Identity Federation (WIF).
#
# Instead of a static API key, this machine gets its own signing key (it never
# leaves the machine). Anthropic gets only the public half. To call the API,
# our code mints a 5-minute, single-use identity token and swaps it for a
# 10-minute Anthropic access token. Nothing secret is ever shown, copied or
# pasted. The only things you paste back are IDs.
#
# The script walks you through the Claude Console, checks the setup with a
# real token exchange, and saves the (non-secret) IDs to the repo's .env.
#
# Usage:  scripts/setup-anthropic-auth.sh
# Env:    GSA_DEVICE=cabinet  to set up another device (default: mac-mini)
#         ENV_FILE=/path/.env to write somewhere other than <repo>/.env

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
IDENTITY="$REPO_ROOT/scripts/wif/identity.mjs"

export GSA_DEVICE="${GSA_DEVICE:-mac-mini}"
export GSA_ISSUER="${GSA_ISSUER:-https://game-studio-arcade.home.arpa}"
export GSA_AUDIENCE="${GSA_AUDIENCE:-https://api.anthropic.com}"
SUBJECT="device:$GSA_DEVICE"
NAME="studio-$GSA_DEVICE"

API="https://api.anthropic.com"
API_VERSION="2026-10-21"
BETA="managed-agents-2026-04-01"
CONSOLE="https://platform.claude.com"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

ask_yn() { # ask_yn "question" y|n
  local ans hint; [[ "$2" == y ]] && hint="[Y/n]" || hint="[y/N]"
  read -r -p "$1 $hint " ans || ans=""
  [[ "${ans:-$2}" =~ ^[Yy] ]]
}
pause() { read -r -p "  Press Return when done… " _ || true; }
open_url() { if ask_yn "  Open $1 in your browser?" y; then open "$1" 2>/dev/null || true; fi; }

ask_id() { # ask_id VAR "prompt" regex "example"
  local var="$1" prompt="$2" re="$3" example="$4" val=""
  local current="${!var:-}"
  while true; do
    if [[ -n "$current" ]]; then
      read -r -p "  $prompt [$current]: " val || val=""
      val="${val:-$current}"
    else
      read -r -p "  $prompt: " val || val=""
    fi
    val="$(printf '%s' "$val" | tr -d '[:space:]')"
    if [[ "$val" =~ $re ]]; then printf -v "$var" '%s' "$val"; return; fi
    err "That doesn't look right (expected something like $example)."
  done
}

# JSON field extraction without jq.
json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));if(v!==undefined)process.stdout.write(String(v))}catch{}})' "$1"; }

# GET with a bearer token passed through a curl config on stdin, so it never
# shows up in the process list. Prints the status line, then the body.
api_get() { # api_get <token> <path> [header]
  local body status; body="$(mktemp)"
  status="$(
    { printf 'header = "authorization: Bearer %s"\n' "$1"
      printf 'header = "anthropic-version: %s"\n' "$API_VERSION"
      [[ -n "${3:-}" ]] && printf 'header = "%s"\n' "$3"
    } | curl -sS -o "$body" -w '%{http_code}' -K - "$API$2" 2>/dev/null
  )" || status="000"
  printf '%s\n' "$status"; cat "$body"; rm -f "$body"
}

# ---------------------------------------------------------------------------

bold "game-studio-arcade: connect \"$GSA_DEVICE\" to the Claude API (Workload Identity Federation)"
cat <<EOF

  Builds run in Claude Managed Agents, billed to your Console org under
  commercial terms (separate from your Claude subscription). You need the
  admin or owner role in that org.
EOF

command -v node >/dev/null || { err "Node is required (brew install node@22)."; exit 1; }
command -v curl >/dev/null || { err "curl is required."; exit 1; }

for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do
  if [[ -n "${!v+x}" ]]; then
    warn "$v is set in your shell. It overrides federation in every SDK and CLI."
    warn "Remove it from your shell profile (e.g. ~/.zshrc) and open a new terminal."
  fi
  if [[ -f "$ENV_FILE" ]] && grep -q "^$v=" "$ENV_FILE"; then
    warn "$ENV_FILE sets $v, which would override federation. This script removes it when saving."
  fi
done

# Load earlier answers, if any, as defaults.
if [[ -f "$ENV_FILE" ]]; then
  for v in ANTHROPIC_ORGANIZATION_ID ANTHROPIC_WORKSPACE_ID ANTHROPIC_SERVICE_ACCOUNT_ID ANTHROPIC_FEDERATION_RULE_ID; do
    line="$(grep "^$v=" "$ENV_FILE" | tail -1 || true)"
    [[ -n "$line" ]] && printf -v "$v" '%s' "${line#*=}"
  done
fi

bold "Step 1: this machine's identity key"
JWKS="$(node "$IDENTITY" keygen)"
ok "The private key stays at ${GSA_IDENTITY_DIR:-~/.config/game-studio-arcade/identity}/$GSA_DEVICE.key.pem (readable only by you)."
echo "  The public key, which is what you'll paste in step 3:"
printf '%s\n' "$JWKS" | sed 's/^/    /'
if printf '%s' "$JWKS" | pbcopy 2>/dev/null; then ok "Copied to the clipboard."; fi

bold "Step 2: a workspace with a spend limit (skip if you already have one)"
cat <<EOF
  a. Create a workspace named  game-studio-arcade
     $CONSOLE/settings/workspaces/new
  b. On the Workspaces page, select it and click "Spend limits". Set a monthly
     cap (suggested \$50; Phase 0 should stay under \$25).
     $CONSOLE/settings/workspaces
EOF
open_url "$CONSOLE/settings/workspaces/new"
pause

bold "Step 3: connect this machine as a workload"
cat <<EOF
  Workload identity → "Connect workload" → choose "Custom OIDC". Enter:

    Issuer URL ............ $GSA_ISSUER
                            (a name, not a website: Anthropic only compares it to the token
                             and never visits it)
    Public keys (JWKS) .... choose the option to paste keys inline, then paste
                            the key from step 1 (already on your clipboard)
    Replay protection ..... on (check jti), which is the default
    Match: subject ........ $SUBJECT        (exact match, no *)
    Match: audience ....... $GSA_AUDIENCE
    Service account ....... $NAME   (it must be a member of game-studio-arcade)
    Federation rule ....... $NAME
    Workspace ............. game-studio-arcade
    Scope ................. workspace:developer   (the default; it covers Managed Agents)
    Token lifetime ........ 600 seconds   (the wizard's default)

  Skip "Verify issuer": with inline keys there is nothing for it to fetch.
  When the wizard says it's waiting for a token exchange, come back here. Step 5
  sends one. Note the IDs it shows: the rule (fdrl_…) and service account (svac_…).
EOF
open_url "$CONSOLE/settings/workload-identity-federation"
pause

bold "Step 4: paste the IDs (none of these are secret)"
echo "  Organization ID: $CONSOLE/settings/organization"
echo "  Workspace ID:    the ID column at $CONSOLE/settings/workspaces"
ask_id ANTHROPIC_ORGANIZATION_ID    "Organization ID" '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' "00000000-0000-0000-0000-000000000000"
ask_id ANTHROPIC_WORKSPACE_ID       "Workspace ID (game-studio-arcade)" '^wrkspc_[A-Za-z0-9]+$' "wrkspc_01…"
ask_id ANTHROPIC_SERVICE_ACCOUNT_ID "Service account ID" '^svac_[A-Za-z0-9]+$' "svac_01…"
ask_id ANTHROPIC_FEDERATION_RULE_ID "Federation rule ID" '^fdrl_[A-Za-z0-9]+$' "fdrl_01…"

bold "Step 5: test it with a real token exchange"
VALID=0
JWT="$(node "$IDENTITY" mint)"
BODY="$(mktemp)"
STATUS="$(
  node -e 'process.stdout.write(JSON.stringify({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:process.argv[1],federation_rule_id:process.argv[2],organization_id:process.argv[3],service_account_id:process.argv[4],workspace_id:process.argv[5]}))' \
    "$JWT" "$ANTHROPIC_FEDERATION_RULE_ID" "$ANTHROPIC_ORGANIZATION_ID" "$ANTHROPIC_SERVICE_ACCOUNT_ID" "$ANTHROPIC_WORKSPACE_ID" \
  | curl -sS -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' --data-binary @- "$API/v1/oauth/token" 2>/dev/null
)" || STATUS="000"
unset JWT
TOKEN="$(json_field access_token < "$BODY")"
MSG="$(json_field error.message < "$BODY")"
rm -f "$BODY"

if [[ "$STATUS" == 200 && -n "$TOKEN" ]]; then
  ok "Token exchange worked (the Console wizard should now show success)."
  R="$(api_get "$TOKEN" /v1/models)"
  if [[ "$(head -1 <<<"$R")" == 200 ]]; then ok "The Claude API accepts the token."; VALID=1
  else err "Models API returned $(head -1 <<<"$R"): $(tail -n +2 <<<"$R" | json_field error.message)"; fi
  R="$(api_get "$TOKEN" '/v1/agents?limit=1' "anthropic-beta: $BETA")"
  if [[ "$(head -1 <<<"$R")" == 200 ]]; then ok "Managed Agents is available."
  else warn "Managed Agents returned $(head -1 <<<"$R"): $(tail -n +2 <<<"$R" | json_field error.message)"; fi
else
  case "$STATUS" in
    401) err "Anthropic rejected the exchange (401 \"${MSG:-Authentication failed}\")."
         echo "    The reason is in the authentication history:"
         echo "    $CONSOLE/settings/workload-identity-federation?tab=history"
         echo "    Common causes: the issuer URL, subject or audience doesn't match exactly; the"
         echo "    pasted key isn't the one from step 1; a wrong rule or service account ID." ;;
    400) err "The request was refused (400): ${MSG:-no message}. Check the IDs." ;;
    000) err "Couldn't reach $API. Check the network." ;;
    *)   err "Unexpected response $STATUS: ${MSG:-no message}" ;;
  esac
fi
unset TOKEN

if [[ $VALID -ne 1 ]] && ! ask_yn "Save the IDs anyway (fix the Console side, then rerun)?" y; then
  exit 1
fi

bold "Step 6: save the settings"
umask 077
touch "$ENV_FILE"
TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
grep -v -E '^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_ORGANIZATION_ID|ANTHROPIC_WORKSPACE_ID|ANTHROPIC_SERVICE_ACCOUNT_ID|ANTHROPIC_FEDERATION_RULE_ID|GSA_DEVICE|GSA_ISSUER|GSA_AUDIENCE)=' "$ENV_FILE" | grep -v '^# Workload Identity Federation' > "$TMP" || true
cat >> "$TMP" <<EOF
# Workload Identity Federation (written by scripts/setup-anthropic-auth.sh). Not secret.
ANTHROPIC_ORGANIZATION_ID=$ANTHROPIC_ORGANIZATION_ID
ANTHROPIC_WORKSPACE_ID=$ANTHROPIC_WORKSPACE_ID
ANTHROPIC_SERVICE_ACCOUNT_ID=$ANTHROPIC_SERVICE_ACCOUNT_ID
ANTHROPIC_FEDERATION_RULE_ID=$ANTHROPIC_FEDERATION_RULE_ID
GSA_DEVICE=$GSA_DEVICE
GSA_ISSUER=$GSA_ISSUER
GSA_AUDIENCE=$GSA_AUDIENCE
EOF
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Saved to $ENV_FILE"
if git -C "$REPO_ROOT" check-ignore -q "$ENV_FILE" 2>/dev/null; then ok "git ignores it."; fi

echo
if [[ $VALID -eq 1 ]]; then
  echo "Done. Tell Claude auth is in place and Phase 0 can start."
else
  echo "Saved, but the test didn't pass. Fix the Console side and run this again; your answers are kept."
fi

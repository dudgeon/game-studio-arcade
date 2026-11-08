#!/usr/bin/env bash
# Runs inside a Managed Agents sandbox. Inventories what Studio sessions can
# rely on and writes the results to /mnt/session/outputs/. Never installs
# anything. Failures are recorded, not fixed.
set -u
OUT=/mnt/session/outputs
mkdir -p "$OUT"
R="$OUT/probe-report.txt"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
: > "$R"

section() { printf '\n===== %s =====\n' "$1" >> "$R"; }
run() { printf '$ %s\n' "$*" >> "$R"; timeout 60 bash -c "$*" >> "$R" 2>&1; printf '[exit %s]\n' "$?" >> "$R"; }

section "identity"
run 'date -u +%FT%TZ; whoami; id'
run 'uname -a; cat /etc/os-release | head -4'
run 'nproc; free -m; df -h / /tmp /mnt/session 2>/dev/null'

section "mounts and kit"
run 'echo "kit extracted to: '"$KIT_DIR"'"; echo "kit tarball: ${GSA_KIT_TARBALL:-unknown}"'
run 'ls -la /mnt/session /mnt/session/uploads 2>&1; find /mnt/session/uploads -maxdepth 3 2>/dev/null | head -20'
run 'touch /mnt/session/uploads/write-test 2>&1 && echo "uploads WRITABLE" || echo "uploads read-only (expected)"'
run 'ls -la /mnt/session/outputs'

section "node"
run 'which -a node; node -v; npm -v; npx -v'
run 'ls -d /usr/local/n/versions/node/* /opt/nodejs* /usr/local/lib/nodejs* ~/.nvm/versions/node/* 2>/dev/null; update-alternatives --list node 2>/dev/null'
run 'npm root -g; npm ls -g --depth=0 2>/dev/null'

section "playwright (node)"
run 'echo "PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-unset}"; ls -la "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"'
run 'find / \( -path /proc -o -path /sys \) -prune -o -path "*/node_modules/playwright/package.json" -print 2>/dev/null | head -10'
run 'find / \( -path /proc -o -path /sys \) -prune -o -path "*/node_modules/playwright-core/package.json" -print 2>/dev/null | head -10'
run 'for f in $(find / \( -path /proc -o -path /sys \) -prune -o \( -path "*/node_modules/playwright/package.json" -o -path "*/node_modules/playwright-core/package.json" -o -path "*/node_modules/@playwright/test/package.json" \) -print 2>/dev/null); do printf "%s  " "$f"; node -p "require(\"$f\").version"; done'
run 'cd /tmp && npx --no-install playwright --version'
run 'NODE_PATH="$(npm root -g)" node -e "console.log(require.resolve(\"playwright\"))"'

section "playwright (python)"
run 'python3 --version; python3 -c "import importlib.metadata as m; print(\"playwright\", m.version(\"playwright\"))"'

section "chromium headless (offline)"
run 'NODE_PATH="$(npm root -g)" node "'"$KIT_DIR"'/chromium-test.cjs"'

section "network (expected: blocked)"
run 'getent hosts example.com || echo "DNS lookup failed"'
run 'curl -sS -m 8 -o /dev/null -w "http %{http_code}\n" https://example.com || echo "curl failed"'
run 'npm view left-pad version --fetch-timeout=8000 --fetch-retries=0 || echo "npm registry unreachable"'

section "other tools"
run 'git --version; python3 -m pip --version; tar --version | head -1; jq --version; ffmpeg -version 2>/dev/null | head -1'
run 'env | grep -E "^(PLAYWRIGHT|NODE|NPM|PATH|HOME|LANG)" | sort'

section "done"
run 'ls -la /mnt/session/outputs'
echo "probe complete: $R"

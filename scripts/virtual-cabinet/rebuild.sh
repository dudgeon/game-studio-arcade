#!/bin/bash
# Destroys the virtual cabinet and builds it again from the lock file: the
# reproducibility proof (D4). Its carts and logs go too (D129), so it asks by flag.
#
#   scripts/virtual-cabinet/rebuild.sh --yes-destroy-this-vm [--network Bridged|Shared]
set -euo pipefail
[ "${1:-}" = "--yes-destroy-this-vm" ] || { sed -n '2,5p' "$0" >&2; exit 2; }
shift
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
VM_ROOT="${GSA_VM_DIR:-$HOME/game-studio-data/vm}"
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
NETWORK=Bridged
[ "${1:-}" = "--network" ] && NETWORK="$2"

state() { "$UTMCTL" status arcade-virtual 2>/dev/null || echo absent; }

if [ "$(state)" = started ]; then
  "$REPO/cabinet/vm/drive" ssh sudo poweroff || true
  for _ in $(seq 1 24); do [ "$(state)" = started ] || break; sleep 5; done
  [ "$(state)" = started ] && "$UTMCTL" stop arcade-virtual
fi
node "$REPO/scripts/virtual-cabinet/build.mjs" --replace --network "$NETWORK"
exec "$REPO/scripts/virtual-cabinet/up.sh" --network "$NETWORK"

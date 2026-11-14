#!/bin/bash
# How the mini finds the Picade (D416). SSH runs this as its ProxyCommand, so everything that reaches the real
# cabinet (cabinet/vm/drive, the Cabinet Manager, updates, the twin) finds it the same way:
#
#   1. arcade.local    the cabinet's own name, by mDNS (avahi on the cabinet)
#   2. arcade.lan, arcade   the name the router's DHCP gives it, when mDNS is quiet
#   3. the last address that worked, kept in the Picade's folder on the mini
#
# SSH still checks the host key under the name arcade.local, whichever way it connected: another machine that
# has taken an old address is refused, not trusted.
#
#   picade-connect.sh HOST PORT      connect, and pass SSH's bytes through (ProxyCommand)
#   picade-connect.sh --where        print the address it would use and how it found it
#
# PICADE_RESOLVE and PICADE_NC replace the name lookup and nc, for its test.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=picade-ssh.sh
. "$HERE/picade-ssh.sh"
LAST="$PICADE_DIR/last-address"
NC="${PICADE_NC:-/usr/bin/nc}"

# A name's IPv4 address, by the mini's own resolver (mDNS for .local, the router's DNS for the rest).
resolve() {
  if [ -n "${PICADE_RESOLVE:-}" ]; then "$PICADE_RESOLVE" "$1"; return; fi
  dscacheutil -q host -a name "$1" 2>/dev/null | awk '/^ip_address:/ { print $2; exit }'
}
answers() { [ -n "$1" ] && "$NC" -z -G 3 "$1" "$2" >/dev/null 2>&1; }
remember() {
  [ "$(cat "$LAST" 2>/dev/null)" = "$1" ] && return 0
  mkdir -p "$PICADE_DIR" && printf '%s\n' "$1" > "$LAST.new" && mv "$LAST.new" "$LAST"
}

# Prints "ADDRESS HOW", or nothing.
find_picade() {
  local host="$1" port="$2" base name ip
  base="${host%.local}"
  for name in "$host" "$base.lan" "$base"; do
    ip="$(resolve "$name")"
    if answers "$ip" "$port"; then
      remember "$ip"
      echo "$ip $name"
      return 0
    fi
  done
  ip="$(cat "$LAST" 2>/dev/null)"
  case "$ip" in *[!0-9.]*|"") return 1 ;; esac
  answers "$ip" "$port" || return 1
  echo "$ip last-address"
}

if [ "${1:-}" = "--where" ]; then
  found="$(find_picade "$PICADE_HOST" 22)" || { echo "can't find the Picade: $PICADE_HOST, its router name and its last address ($(cat "$LAST" 2>/dev/null || echo none)) don't answer" >&2; exit 1; }
  echo "$found"
  exit 0
fi

host="${1:?usage: picade-connect.sh HOST PORT | --where}"
port="${2:-22}"
found="$(find_picade "$host" "$port")" || { echo "picade-connect: can't find the Picade: $host, its router name and its last address ($(cat "$LAST" 2>/dev/null || echo none)) don't answer" >&2; exit 1; }
ip="${found%% *}"
how="${found#* }"
[ "$how" = "$host" ] || echo "picade-connect: $host didn't answer by name; reaching it at $ip ($how)" >&2
exec "$NC" -G 8 "$ip" "$port"

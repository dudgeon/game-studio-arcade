#!/bin/bash
# How the mini finds the Picade (D416). SSH runs this as its ProxyCommand, so everything that reaches the real
# cabinet (cabinet/vm/drive, the Cabinet Manager, updates, the twin) finds it the same way:
#
#   1. arcade.local    the cabinet's own name, by mDNS (avahi on the cabinet)
#   2. arcade.lan, arcade   the name the router's DHCP gives it, when mDNS is quiet
#   3. the last address that worked, kept in the Picade's folder on the mini
#   4. off the home Wi-Fi altogether: Tailscale's address for it, a cable straight to its Ethernet port (its
#      link-local address), its USB-C service port; the last two from last-known-address.json in that folder
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
ipv4() { case "$1" in ""|*[!0-9.]*) return 1 ;; esac; }
# What the card worker recorded of the Picade's other ways in: eth0's link-local address, the USB port's address.
KNOWN="$PICADE_DIR/last-known-address.json"
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
  if ipv4 "$ip" && answers "$ip" "$port"; then echo "$ip last-address"; return 0; fi
  # Off the home Wi-Fi altogether (D395-D397, the card worker's service paths): Tailscale, once a person has signed
  # the cabinet in; then a cable straight to the Pi's Ethernet port; then its USB-C service port.
  local ts=""
  for ts in "$(command -v tailscale 2>/dev/null)" /Applications/Tailscale.app/Contents/MacOS/Tailscale; do [ -x "$ts" ] && break; ts=""; done
  if [ -n "${PICADE_TAILSCALE-$ts}" ]; then
    ip="$("${PICADE_TAILSCALE-$ts}" ip -4 "$base" 2>/dev/null | head -1)"
    if ipv4 "$ip" && answers "$ip" "$port"; then echo "$ip tailscale"; return 0; fi
  fi
  ip="$(sed -n 's/.*"link_local": *"\(fe80:[0-9a-f:]*\)".*/\1/p' "$KNOWN" 2>/dev/null | head -1)"
  if [ -n "$ip" ] && answers "$ip%${PICADE_CABLE_IF:-en0}" "$port"; then echo "$ip%${PICADE_CABLE_IF:-en0} direct-cable"; return 0; fi
  ip="$(sed -n 's/.*"usb_gadget": *{ *"ipv4": *"\([0-9.]*\)".*/\1/p' "$KNOWN" 2>/dev/null | head -1)"
  if ipv4 "$ip" && answers "$ip" "$port"; then echo "$ip usb-port"; return 0; fi
  return 1
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

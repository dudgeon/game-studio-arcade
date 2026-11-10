#!/bin/bash
# A stand-in for the mini-to-VM gaps (D156), for testing the driver when the real ones aren't happening.
# On the cabinet, for MINUTES: drop every packet to and from the mini for GAP_S seconds every PERIOD_S seconds,
# like the gaps measured on 2026-11-09 (about 40 s every 3.5 minutes). Both directions, so held connections
# stall as they did. Nothing else on the network is affected.
#
#   scripts/virtual-cabinet/test/gap-sim.sh MINUTES [GAP_S] [PERIOD_S]     default 40 210
#   ARP=1 scripts/virtual-cabinet/test/gap-sim.sh ...                       ARP blocked too, as the real ones seemed
#
# It's a test, not a networking change. The rules sit in their own table, which the cabinet removes when the
# time is up. A restart removes them too, because they're never saved. The bridged setup isn't touched.
set -u
MINUTES="${1:?usage: gap-sim.sh MINUTES [GAP_S] [PERIOD_S]}"; GAP_S="${2:-40}"; PERIOD_S="${3:-210}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
MINI="$(ifconfig en1 | sed -n 's/.*inet \([0-9.]*\) .*/\1/p' | head -1)"
[ -n "$MINI" ] || { echo "can't find the mini's address" >&2; exit 1; }
"$REPO/cabinet/vm/drive" ssh "sudo systemctl stop arcade-gapsim 2>/dev/null; sudo systemctl reset-failed arcade-gapsim 2>/dev/null; cat > /tmp/arcade-gapsim.sh; chmod +x /tmp/arcade-gapsim.sh; sudo systemd-run --quiet --unit=arcade-gapsim --setenv=ARP=${ARP:-0} /tmp/arcade-gapsim.sh $MINI $MINUTES $GAP_S $PERIOD_S" <<'GUEST'
#!/bin/bash
MINI="$1"; END=$(( $(date +%s) + $2 * 60 )); GAP="$3"; PERIOD="$4"
L=/tmp/arcade-gapsim.log
off() { nft delete table inet arcade_gapsim 2>/dev/null; nft delete table arp arcade_gapsim 2>/dev/null; }
trap off EXIT
# A quiet start, so whatever drives the cabinet is under way first.
sleep 60
while [ "$(date +%s)" -lt "$END" ]; do
  nft -f - <<EOF
table inet arcade_gapsim {
  chain in { type filter hook input priority -10; policy accept; ip saddr $MINI drop; }
  chain out { type filter hook output priority -10; policy accept; ip daddr $MINI drop; }
}
EOF
  # With ARP blocked too, the mini can lose the guest's address, which turns a stall into "Host is down".
  [ "${ARP:-}" = 1 ] && nft -f - <<EOF
table arp arcade_gapsim {
  chain in { type filter hook input priority 0; policy accept; arp saddr ip $MINI drop; }
  chain out { type filter hook output priority 0; policy accept; arp daddr ip $MINI drop; }
}
EOF
  echo "$(date -u +%FT%TZ) gap on" >> "$L"
  sleep "$GAP"
  off
  echo "$(date -u +%FT%TZ) gap off" >> "$L"
  sleep $(( PERIOD - GAP ))
done
GUEST
echo "gaps of $GAP_S s every $PERIOD_S s for $MINUTES minutes, starting in 60 s. The cabinet's log: /tmp/arcade-gapsim.log"

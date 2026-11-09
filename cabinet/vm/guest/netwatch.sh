#!/bin/bash
# Run on the cabinet by scripts/virtual-cabinet/soak.sh, through `drive run`. Starts a watcher that outlives
# the SSH session: every 5 s, can this cabinet reach its router and api.anthropic.com? A plain request with
# no key: free, and any HTTP answer counts as reachable. It logs to the boot partition, which the mini can
# read with the VM stopped, so an outage that locks the mini out can still be read afterwards.
sudo systemctl stop arcade-netwatch 2>/dev/null
cat > /tmp/arcade-netwatch.sh <<'EOF'
#!/bin/bash
L=/boot/firmware/netwatch.log
gw="$(ip route | sed -n 's/^default via \([^ ]*\).*/\1/p' | head -1)"
echo "$(date -u +%FT%TZ) BOOT uptime=$(cut -d' ' -f1 /proc/uptime)s router=$gw" >> "$L"
last=""; n=0; ok=0
while true; do
  gw="$(ip route | sed -n 's/^default via \([^ ]*\).*/\1/p' | head -1)"
  addr="$(ip -4 -br addr show eth0 2>/dev/null | awk '{print $2,$3}')"
  if [ -n "$gw" ] && ping -c1 -W2 "$gw" >/dev/null 2>&1; then r=up; else r=DOWN; fi
  code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models)"
  if [ "${code:-000}" != 000 ]; then a=up; else a=DOWN; fi
  n=$((n + 1)); [ "$r$a" = upup ] && ok=$((ok + 1))
  s="addr=$addr router=$r api=$a"
  if [ "$s" != "$last" ]; then echo "$(date -u +%FT%TZ) CHANGE $s" >> "$L"; last="$s"; sync; fi
  if [ $((n % 60)) = 0 ]; then echo "$(date -u +%FT%TZ) COUNT probes=$n both-up=$ok" >> "$L"; sync; fi
  sleep 5
done
EOF
chmod +x /tmp/arcade-netwatch.sh
sudo systemctl reset-failed arcade-netwatch 2>/dev/null
sudo systemd-run --quiet --unit=arcade-netwatch /tmp/arcade-netwatch.sh
echo started

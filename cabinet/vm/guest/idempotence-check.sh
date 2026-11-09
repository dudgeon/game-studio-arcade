#!/bin/bash
# Runs the provisioning script again on a provisioned cabinet and checks that nothing changed.
# Run on the cabinet: cabinet/vm/drive run cabinet/vm/guest/idempotence-check.sh
set -u
state() {
  {
    dpkg-query -W -f='${Package}=${Version}\n'
    readlink -f /opt/arcade/current
    readlink -f /usr/local/bin/node
    cat /etc/hostname /etc/nftables.conf /etc/arcade/kiosk.env /etc/arcade/cabinet.conf /etc/arcade/mini-addrs /etc/sudoers.d/010-cabinet /home/cabinet/.ssh/authorized_keys 2>&1
    sha256sum /etc/systemd/system/arcade-*.service /usr/local/bin/arcade-* 2>&1
    systemctl is-enabled arcade-launcher arcade-kiosk arcade-keyd nftables 2>&1
  } | sudo sh -c 'cat'
}
data() { sudo sh -c 'cd /var/lib/arcade && find carts logs -type f -print0 | sort -z | xargs -0 sha256sum'; }

state > /tmp/state-before
data > /tmp/data-before
sudo sh -c 'mkdir -p /var/lib/arcade/carts/collect && echo kept >> /var/lib/arcade/carts/collect/idempotence-marker'
data > /tmp/data-marked
sudo bash /opt/arcade/provision/provision.sh --profile virtual --payload /boot/firmware/seed > /tmp/reprovision.log 2>&1
rc=$?
echo "re-run exit $rc; last line: $(tail -1 /tmp/reprovision.log)"
grep -c 'installing:' /tmp/reprovision.log | sed 's/^/apt installs on re-run: /'
state > /tmp/state-after
data > /tmp/data-after
fail=0
[ "$rc" = 0 ] || fail=1
if diff /tmp/state-before /tmp/state-after; then echo "system state unchanged"; else echo "SYSTEM STATE CHANGED"; fail=1; fi
if diff /tmp/data-marked /tmp/data-after; then echo "carts and logs untouched, marker kept"; else echo "DATA CHANGED"; fail=1; fi
sudo rm -f /var/lib/arcade/carts/collect/idempotence-marker
sleep 6
systemctl is-active arcade-launcher arcade-kiosk arcade-keyd nftables | tr '\n' ' '; echo
exit "$fail"

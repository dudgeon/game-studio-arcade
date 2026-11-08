#!/bin/sh
# The virtual cabinet's early boot (D140). Mounts the stock Pi OS root with
# Debian's kernel, and on the first boot plants what the OS needs from the seed.
PATH=/bin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev
exec >/dev/hvc0 2>&1 || true
echo "[arcade-init] loading modules"
for m in @MODULES@; do insmod "/mods/$m.ko" || echo "[arcade-init] insmod $m failed"; done

fail() {
  echo "[arcade-init] FAILED: $1"
  sleep 3600
  exit 1
}

i=0
while [ ! -b /dev/vda2 ]; do
  i=$((i + 1))
  [ "$i" -gt 100 ] && fail "no /dev/vda2"
  sleep 0.1
done

mount -t ext4 -o rw /dev/vda2 /newroot || fail "mount root"
SEED=/newroot/boot/firmware
mount -t vfat /dev/vda1 "$SEED" || fail "mount boot partition"

MODS=/newroot/usr/lib/modules/@KERNEL_RELEASE@
if [ ! -d "$MODS" ] && [ -f "$SEED/seed/kernel-modules.tar.gz" ]; then
  echo "[arcade-init] installing kernel modules"
  gzip -dc "$SEED/seed/kernel-modules.tar.gz" | tar -x -C /newroot || fail "install modules"
fi

SYSD=/newroot/etc/systemd/system
if [ -f "$SEED/seed/arcade-seed.service" ] && [ ! -e /newroot/etc/arcade/provisioned-version ]; then
  echo "[arcade-init] planting first-boot service"
  cp "$SEED/seed/arcade-seed.service" "$SYSD/arcade-seed.service"
  ln -sf ../arcade-seed.service "$SYSD/multi-user.target.wants/arcade-seed.service"
  [ -f "$SEED/seed/hostname" ] && cp "$SEED/seed/hostname" /newroot/etc/hostname
  # Pi OS's first-boot user wizard and cloud-init are for a Pi's card; this seed replaces them.
  mkdir -p /newroot/etc/cloud
  : > /newroot/etc/cloud/cloud-init.disabled
  ln -sf /dev/null "$SYSD/userconfig.service"
  # modules.dep isn't in the kernel package. Build it before udev needs it.
  cat > "$SYSD/arcade-depmod.service" <<UNIT
[Unit]
Description=Index the kernel modules before udev starts
DefaultDependencies=no
Before=sysinit.target systemd-udevd.service systemd-modules-load.service
ConditionPathExists=!/usr/lib/modules/@KERNEL_RELEASE@/modules.dep

[Service]
Type=oneshot
ExecStart=/usr/sbin/depmod -a @KERNEL_RELEASE@

[Install]
WantedBy=sysinit.target
UNIT
  mkdir -p "$SYSD/sysinit.target.wants"
  ln -sf ../arcade-depmod.service "$SYSD/sysinit.target.wants/arcade-depmod.service"
fi

umount "$SEED" || true
umount /proc /sys
mount --move /dev /newroot/dev
echo "[arcade-init] handing over to systemd"
exec switch_root /newroot /sbin/init

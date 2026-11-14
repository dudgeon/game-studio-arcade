#!/usr/bin/env node
// A rehearsal of the Picade's first boot, in a throwaway headless QEMU VM on the mini (D300+ validation; the
// card's D250-D259). The card image is flash.mjs's own (--image-file), booted as it is, so cloud-init, the
// seed service and provision.sh --profile picade run exactly as on the card. What stands in for the Pi:
//   - Debian's generic arm64 kernel (the pinned one the virtual cabinet uses), since the Pi's kernel won't boot
//     here, with a small initramfs that only mounts the root and adds that kernel's modules. It plants nothing
//     of ours: first boot must find the seed through cloud-init, as on the card.
//   - Growing the root partition, which the Pi's own initramfs does (`resize` in cmdline.txt).
//   - Ethernet through QEMU's user network instead of the basement Wi-Fi, and a virtio GPU instead of the panel.
//
//   node scripts/cabinet-card/rehearse.mjs prepare DIR    write the card image and the kernel there
//   node scripts/cabinet-card/rehearse.mjs start DIR      boot it in the background (no window)
//   node scripts/cabinet-card/rehearse.mjs shot DIR NAME  save the VM's screen as DIR/NAME.png
//   node scripts/cabinet-card/rehearse.mjs ssh DIR CMD    a command on it, as the cabinet's admin
//   node scripts/cabinet-card/rehearse.mjs stop DIR       power it off
//
// Nothing here touches the virtual cabinet, its UTM VM or its network link. DIR is all of it: delete it after.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync, writeSync, readdirSync, rmSync, truncateSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { PICADE_KEY_NAME } from "./picade.mjs";
import { cpioNewc, dir, file, growSecondPartition, link, loadOrder, modinfoValues, normalizeModule, unwrapZboot } from "../virtual-cabinet/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const lock = JSON.parse(readFileSync(join(REPO, "cabinet/provision/lock.json"), "utf8"));
const DL = join(process.env.GSA_VM_DIR || join(homedir(), "game-studio-data/vm"), "dl");
const NODE = process.execPath;
const DISK_BYTES = 16 * 2 ** 30;
const SSH_PORT = Number(process.env.REHEARSE_SSH_PORT || 2299);
const MODULES = ["virtio_pci", "virtio_blk", "ext4", "vfat", "nls_cp437", "nls_ascii", "crc32c_generic"];
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: "utf8", maxBuffer: 2 ** 28, ...o });
const say = (m) => console.log(`[rehearse] ${m}`);

function debData(deb, work) {
  mkdirSync(work, { recursive: true });
  run("ar", ["x", deb], { cwd: work });
  return join(work, readdirSync(work).find((f) => f.startsWith("data.tar")));
}

const INIT = `#!/bin/sh
# The rehearsal's early boot: stands in for the Pi's firmware and initramfs, nothing more.
PATH=/bin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev
for m in @MODULES@; do insmod "/mods/$m.ko" 2>/dev/null; done
i=0
while [ ! -b /dev/vda2 ]; do i=$((i + 1)); [ "$i" -gt 100 ] && { echo "[rehearse-init] no /dev/vda2"; sleep 3600; }; sleep 0.1; done
mount -t ext4 -o rw /dev/vda2 /newroot || { echo "[rehearse-init] mount root failed"; sleep 3600; }
R=/newroot
SYSD=$R/etc/systemd/system
if [ ! -d "$R/usr/lib/modules/@REL@" ]; then
  echo "[rehearse-init] adding Debian's kernel modules (the Pi's kernel stands here)"
  gzip -dc /kernel-modules.tar.gz | tar -x -C "$R"
  mkdir -p "$SYSD/sysinit.target.wants" "$R/etc/modules-load.d"
  cat > "$SYSD/rehearse-depmod.service" <<UNIT
[Unit]
Description=Rehearsal: index Debian's kernel modules before udev
DefaultDependencies=no
Before=sysinit.target systemd-udevd.service systemd-modules-load.service
ConditionPathExists=!/usr/lib/modules/@REL@/modules.dep
[Service]
Type=oneshot
ExecStart=/usr/sbin/depmod -a @REL@
UNIT
  ln -sf ../rehearse-depmod.service "$SYSD/sysinit.target.wants/rehearse-depmod.service"
  # The Pi's kernel has these built in; Debian's has them as modules.
  printf 'loop\\nuinput\\n' > "$R/etc/modules-load.d/rehearse.conf"
  # The Pi's initramfs grows the root partition on first boot; here a unit grows the filesystem the script grew.
  cat > "$SYSD/rehearse-resize.service" <<UNIT
[Unit]
Description=Rehearsal: grow the root filesystem, as the Pi's initramfs does
DefaultDependencies=no
After=systemd-remount-fs.service
Before=local-fs.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/resize2fs /dev/vda2
UNIT
  ln -sf ../rehearse-resize.service "$SYSD/sysinit.target.wants/rehearse-resize.service"
fi
umount /proc /sys
mount --move /dev "$R/dev"
exec switch_root "$R" /sbin/init
`;

function initrd(kernelData, busyboxData, release, work) {
  const listing = run("tar", ["-tf", kernelData]).split("\n");
  const prefix = `./usr/lib/modules/${release}/`;
  const index = new Map();
  for (const p of listing) {
    const m = p.startsWith(prefix) && p.match(/([^/]+)\.ko(\.xz)?$/);
    if (m) index.set(normalizeModule(m[1]), p);
  }
  const kos = new Map();
  let frontier = MODULES.map(normalizeModule);
  while (frontier.length) {
    const members = frontier.map((n) => index.get(n)).filter(Boolean);
    if (members.length) run("tar", ["-xf", kernelData, "-C", work, ...members]);
    const next = new Set();
    for (const n of frontier) {
      const member = index.get(n);
      if (!member) continue;
      const ko = member.endsWith(".xz") ? execFileSync("xz", ["-dc", join(work, member)], { maxBuffer: 2 ** 28 }) : readFileSync(join(work, member));
      kos.set(n, ko);
      for (const v of modinfoValues(ko, "depends")) for (const d of v.split(",").filter(Boolean)) if (!kos.has(normalizeModule(d))) next.add(normalizeModule(d));
    }
    frontier = [...next];
  }
  const order = loadOrder(MODULES, (n) => (kos.get(n) ? modinfoValues(kos.get(n), "depends").flatMap((v) => v.split(",").filter(Boolean)) : [])).filter((n) => kos.has(n));
  run("tar", ["-xf", busyboxData, "-C", work, "./usr/bin/busybox"]);
  const modsTgz = join(work, "kernel-modules.tar.gz");
  run("tar", ["-czf", modsTgz, "--format", "gnutar", "--include", `./usr/lib/modules/${release}*`, `@${kernelData}`]);
  const init = INIT.replace("@MODULES@", order.join(" ")).replace(/@REL@/g, release);
  const entries = [dir("bin"), dir("dev"), dir("proc"), dir("sys"), dir("newroot"), dir("mods"), file("bin/busybox", readFileSync(join(work, "usr/bin/busybox")), 0o755), link("bin/sh", "busybox"), file("init", Buffer.from(init), 0o755), file("kernel-modules.tar.gz", readFileSync(modsTgz))];
  for (const n of order) entries.push(file(`mods/${n}.ko`, kos.get(n)));
  say(`initramfs modules: ${order.join(" ")}`);
  return gzipSync(cpioNewc(entries));
}

function prepare(out) {
  mkdirSync(out, { recursive: true });
  const img = join(out, "card.img");
  if (!existsSync(img)) {
    // The real flash path, into a file; a stand-in Wi-Fi network (there's no Wi-Fi in the VM).
    // REHEARSE_CONFIG: a file of throwaway keys and ids for the card (never real ones), or none for an offline card.
    const config = process.env.REHEARSE_CONFIG ? ["--cabinet-config-from", process.env.REHEARSE_CONFIG] : ["--no-identity"];
    // REHEARSE_TWIN_DIR: a folder of throwaway twin data for the card (D324), or none.
    if (process.env.REHEARSE_TWIN_DIR) config.push("--twin-dir", process.env.REHEARSE_TWIN_DIR);
    else if (!process.env.REHEARSE_FROM_BACKUP) config.push("--no-seed");
    // REHEARSE_FROM_BACKUP: the dead-card restore (D354), from GSA_TWIN_DIR's backup folder. REHEARSE_DAY_ONE: a day-one file (D356).
    if (process.env.REHEARSE_FROM_BACKUP) config.push("--from-backup");
    if (process.env.REHEARSE_DAY_ONE) config.push("--day-one", process.env.REHEARSE_DAY_ONE);
    const r = spawnSync(NODE, [join(HERE, "flash.mjs"), "--image-file", img, "--allow-dirty", ...config], {
      input: "Rehearsal network\nrehearsal-password-123\n",
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, GSA_CABINET_DIR: join(out, "cabinet") },
    });
    if (r.status !== 0) throw new Error("flash.mjs failed");
  }
  // Grow the disk and its root partition, as the Pi's first boot does on a real card.
  const disk = join(out, "disk.img");
  if (!existsSync(disk)) {
    run("cp", ["-c", img, disk]); // a clone on APFS: instant, and card.img stays as flash.mjs wrote it
    truncateSync(disk, DISK_BYTES);
    const fd = openSync(disk, "r+");
    const mbr = Buffer.alloc(512);
    readSync(fd, mbr, 0, 512, 0);
    writeSync(fd, growSecondPartition(mbr, DISK_BYTES), 0, 512, 0);
    closeSync(fd);
  }
  const work = join(out, "kernel-work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  const kernelData = debData(join(DL, lock.virtual.kernel_deb.name), join(work, "kdeb"));
  const busyboxData = debData(join(DL, lock.virtual.busybox_deb.name), join(work, "bdeb"));
  const release = lock.virtual.kernel_release;
  run("tar", ["-xf", kernelData, "-C", work, `./boot/vmlinuz-${release}`]);
  writeFileSync(join(out, "Image"), unwrapZboot(readFileSync(join(work, "boot", `vmlinuz-${release}`))));
  writeFileSync(join(out, "initrd"), initrd(kernelData, busyboxData, release, work));
  rmSync(work, { recursive: true, force: true });
  say(`ready in ${out}: card.img (as flash.mjs wrote it), disk.img (grown to 16 GiB), Image, initrd`);
}

function start(out) {
  const pidFile = join(out, "qemu.pid");
  if (existsSync(pidFile) && spawnSync("kill", ["-0", readFileSync(pidFile, "utf8").trim()]).status === 0) throw new Error("already running");
  const args = [
    "-machine", "virt", "-accel", "hvf", "-cpu", "host", "-smp", "4", "-m", "4096",
    "-kernel", join(out, "Image"), "-initrd", join(out, "initrd"),
    // The card's own cmdline.txt, less what only the Pi's boot understands (serial0, PARTUUID root, resize).
    "-append", "console=ttyAMA0 console=tty1 root=/dev/vda2 rootfstype=ext4 fsck.repair=yes rootwait",
    "-drive", `file=${join(out, "disk.img")},if=none,id=d0,format=raw,cache=writeback`, "-device", "virtio-blk-pci,drive=d0",
    "-netdev", `user,id=n0,hostfwd=tcp:127.0.0.1:${SSH_PORT}-:22`, "-device", "virtio-net-pci,netdev=n0",
    "-device", "virtio-gpu-pci,xres=1024,yres=768", "-device", "qemu-xhci", "-device", "usb-kbd",
    "-display", "none", "-serial", `file:${join(out, "serial.log")}`, "-monitor", "none",
    "-qmp", `unix:${join(out, "qmp.sock")},server,nowait`, "-pidfile", pidFile, "-daemonize",
  ];
  run("qemu-system-aarch64", args);
  writeFileSync(join(out, "started"), `${new Date().toISOString()}\n`);
  say(`started (pid ${readFileSync(pidFile, "utf8").trim()}); serial log ${join(out, "serial.log")}; ssh on 127.0.0.1:${SSH_PORT}`);
}

function qmp(out, commands) {
  return new Promise((res, rej) => {
    const s = connect(join(out, "qmp.sock"));
    let buf = "";
    const queue = [{ execute: "qmp_capabilities" }, ...commands];
    s.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (line.QMP || "return" in line || line.error) {
          if (line.error) return rej(new Error(line.error.desc));
          const next = queue.shift();
          if (next) s.write(`${JSON.stringify(next)}\n`);
          else { s.end(); res(); }
        }
      }
    });
    s.on("error", rej);
  });
}

async function shot(out, name) {
  const ppm = join(out, `${name}.ppm`);
  await qmp(out, [{ execute: "screendump", arguments: { filename: ppm } }]);
  for (let i = 0; i < 20 && !existsSync(ppm); i++) await new Promise((r) => setTimeout(r, 100));
  run("sips", ["-s", "format", "png", ppm, "--out", join(out, `${name}.png`)]);
  rmSync(ppm);
  say(`saved ${join(out, `${name}.png`)}`);
}

function ssh(out, cmd) {
  const key = join(out, "cabinet/ssh", PICADE_KEY_NAME);
  const r = spawnSync("ssh", ["-i", key, "-p", String(SSH_PORT), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", "-o", `UserKnownHostsFile=${join(out, "known_hosts")}`, "cabinet@127.0.0.1", cmd], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
}

async function stop(out) {
  try {
    await qmp(out, [{ execute: "quit" }]);
  } catch {}
  say("stopped");
}

const [cmd, out, extra] = process.argv.slice(2);
if (!out) {
  console.error("usage: rehearse.mjs prepare|start|shot|ssh|stop DIR [NAME|CMD]");
  process.exit(2);
}
const D = resolve(out);
try {
  if (cmd === "prepare") prepare(D);
  else if (cmd === "start") start(D);
  else if (cmd === "shot") await shot(D, extra ?? "screen");
  else if (cmd === "ssh") ssh(D, process.argv.slice(4).join(" "));
  // A key on the VM's USB keyboard, by QEMU's name: z is A, x is B, ret is START, esc is ESC (D82).
  else if (cmd === "key") await qmp(D, [{ execute: "send-key", arguments: { keys: [{ type: "qcode", data: extra }], "hold-time": 80 } }]);
  else if (cmd === "stop") await stop(D);
  else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  console.error(`[rehearse] FAILED: ${e.message}`);
  process.exit(1);
}

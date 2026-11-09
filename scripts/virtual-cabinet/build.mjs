#!/usr/bin/env node
// Generates the virtual cabinet's UTM VM from the lock file (D123, D140, D143).
// Needs no UTM and shows no window: everything here is files on the mini.
//
//   node scripts/virtual-cabinet/build.mjs [--replace] [--network Bridged|Shared] [--bridge en1]
//
// --serial-console adds a serial device for debugging. Always run serial.sh with it, or the guest freezes (D148).
// Output: ~/game-studio-data/vm/arcade-virtual.utm (never in git). It refuses to
// overwrite an existing VM unless you pass --replace.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, truncateSync, writeFileSync, writeSync, createReadStream, createWriteStream } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { cpioNewc, dir, file, growSecondPartition, link, loadOrder, makeBundle, makeProvisionTar, modinfoValues, normalizeModule, partition, unwrapZboot, utmConfig } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const VM_ROOT = process.env.GSA_VM_DIR || join(homedir(), "game-studio-data/vm");
const DL = join(VM_ROOT, "dl");
const NAME = "arcade-virtual";
const PACKAGE = join(VM_ROOT, `${NAME}.utm`);
const DISK_BYTES = 32 * 2 ** 30;
// Fixed, so a rebuilt VM is the same machine on the network (locally administered MAC).
const MAC = "5a:47:41:43:41:42";
const UUID = "6F0C9A52-3B1E-4D7A-8C24-A1B2C3D4E5F6";
// UTM's serial device is a pseudo-terminal. When nobody reads it and its buffer fills, the kernel spins and
// the guest freezes, whatever console= says. So the VM has none, unless a debug build asks for it (D148).
const SERIAL = process.argv.includes("--serial-console");
const CMDLINE = `console=${SERIAL ? "hvc0" : "tty0"} root=/dev/vda2 rw`;
const BOOT_MODULES = ["virtio_blk", "ext4", "vfat", "nls_cp437", "nls_ascii", "crc32c_generic"];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const network = opt("--network", "Bridged");
const bridge = opt("--bridge", "en1");
const lock = JSON.parse(readFileSync(join(REPO, "cabinet/provision/lock.json"), "utf8"));
const say = (m) => console.log(`[build] ${m}`);
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: "utf8", ...o });

async function sha256(path) {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

/** Fetch a pinned file into dl/ and check its SHA-256. */
async function fetchPinned({ name, url, sha256: want }) {
  const path = join(DL, name);
  if (!existsSync(path) || (await sha256(path)) !== want) {
    say(`downloading ${name}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(path));
    const got = await sha256(path);
    if (got !== want) throw new Error(`${name}: checksum ${got}, expected ${want}`);
  }
  say(`ok ${name} ${want.slice(0, 12)}`);
  return path;
}

/** Unpack a .deb's data.tar.* to a work folder, and return its path. `ar` is on macOS. */
function debData(deb, work) {
  mkdirSync(work, { recursive: true });
  run("ar", ["x", deb], { cwd: work });
  const data = readdirSync(work).find((f) => f.startsWith("data.tar"));
  if (!data) throw new Error(`no data.tar in ${deb}`);
  return join(work, data);
}

/** Pull named members into a folder. Only named ones: the whole tree has case clashes on APFS. */
function tarExtract(tar, dest, members) {
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xf", tar, "-C", dest, ...members], { maxBuffer: 2 ** 26 });
}

function buildInitrd({ kernelData, busyboxData, release, work }) {
  const listing = run("tar", ["-tf", kernelData], { maxBuffer: 2 ** 28 }).split("\n");
  const prefix = `./usr/lib/modules/${release}/`;
  const index = new Map();
  for (const p of listing) {
    const m = p.startsWith(prefix) && p.match(/([^/]+)\.ko(\.xz)?$/);
    if (m) index.set(normalizeModule(m[1]), p);
  }
  const modDir = join(work, "mods");
  const kos = new Map();
  const load = (names) => {
    const members = names.map((n) => index.get(n)).filter(Boolean);
    if (!members.length) return;
    tarExtract(kernelData, modDir, members);
    for (const n of names) {
      const member = index.get(n);
      if (!member) continue;
      const path = join(modDir, member);
      kos.set(n, member.endsWith(".xz") ? execFileSync("xz", ["-dc", path], { maxBuffer: 2 ** 28 }) : readFileSync(path));
    }
  };
  // Breadth first, so each tar pass (a full xz decompress) picks up a whole level of dependencies.
  let frontier = BOOT_MODULES.map(normalizeModule);
  for (const n of frontier) if (!index.has(n)) say(`note: ${n} is not a module here (built in?)`);
  while (frontier.length) {
    load(frontier);
    const next = new Set();
    for (const n of frontier) {
      const ko = kos.get(n);
      if (!ko) continue;
      for (const v of modinfoValues(ko, "depends")) for (const d of v.split(",").filter(Boolean)) {
        const dep = normalizeModule(d);
        if (!kos.has(dep)) next.add(dep);
      }
    }
    frontier = [...next];
  }
  const dependsOf = (n) => {
    const ko = kos.get(n);
    if (!ko) return [];
    return modinfoValues(ko, "depends").flatMap((v) => v.split(",").filter(Boolean));
  };
  const order = loadOrder(BOOT_MODULES, dependsOf).filter((n) => kos.has(n));
  say(`initramfs modules: ${order.join(" ")}`);

  tarExtract(busyboxData, join(work, "bb"), ["./usr/bin/busybox"]);
  const busybox = readFileSync(join(work, "bb/usr/bin/busybox"));
  const init = readFileSync(join(HERE, "initramfs-init.sh"), "utf8")
    .replace("@MODULES@", order.join(" "))
    .replace(/@KERNEL_RELEASE@/g, release);
  const entries = [dir("bin"), dir("dev"), dir("proc"), dir("sys"), dir("newroot"), dir("mods"), file("bin/busybox", busybox, 0o755), link("bin/sh", "busybox"), file("init", Buffer.from(init), 0o755)];
  for (const n of order) entries.push(file(`mods/${n}.ko`, kos.get(n)));
  return gzipSync(cpioNewc(entries));
}

/** The kernel's modules as a tgz, passed archive to archive so APFS's case rules never touch them. */
function modulesTarball(kernelData, release, out) {
  run("tar", ["-czf", out, "--format", "gnutar", "--include", `./usr/lib/modules/${release}*`, `@${kernelData}`], { maxBuffer: 2 ** 26 });
}

/** The cabinet's own SSH key on the mini; never one of the mini's existing keys (D123). */
function sshKey() {
  const keyDir = join(VM_ROOT, "ssh");
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const key = join(keyDir, `${NAME}_ed25519`);
  if (!existsSync(key)) run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `${NAME}-driver`, "-f", key]);
  return `${key}.pub`;
}

/** The mini's own IPv4 and IPv6 addresses, for the VM's firewall (D124). */
function miniAddrs() {
  const addrs = new Set(network === "Shared" ? ["192.168.64.1"] : []);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal) addrs.add(a.address.split("%")[0]);
  }
  return [...addrs].sort();
}

function writeSeed(mount, { modulesTgz, nodeTarball, profile }) {
  const seed = join(mount, "seed");
  mkdirSync(seed, { recursive: true });
  const provDir = join(REPO, "cabinet/provision");
  makeProvisionTar(REPO, join(seed, "provision.tar.gz"));
  say(`bundle.tar.gz: ${makeBundle(REPO, join(seed, "bundle.tar.gz"))} files`);
  writeFileSync(join(seed, "commit"), `${run("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO }).trim()}\n`);
  cpSync(modulesTgz, join(seed, "kernel-modules.tar.gz"));
  cpSync(nodeTarball, join(seed, lock.node.name));
  cpSync(join(provDir, "files/firstboot.sh"), join(seed, "firstboot.sh"));
  cpSync(join(provDir, "files/arcade-seed.service"), join(seed, "arcade-seed.service"));
  writeFileSync(join(seed, "profile"), `${profile}\n`);
  writeFileSync(join(seed, "hostname"), `${NAME}\n`);
  writeFileSync(join(seed, "mini-addrs"), `${miniAddrs().join("\n")}\n`);
  cpSync(sshKey(), join(seed, "authorized_keys"));
  // macOS leaves AppleDouble files beside anything with extended attributes on FAT.
  for (const name of readdirSync(seed)) if (name.startsWith("._")) rmSync(join(seed, name));
}

/** Attach the raw disk with no Finder presence, mount its FAT partition, run fn, detach. */
function withBootPartition(disk, fn) {
  const mountRoot = mkdtempSync(join(VM_ROOT, ".mnt-"));
  const plist = run("hdiutil", ["attach", "-imagekey", "diskimage-class=CRawDiskImage", "-nobrowse", "-owners", "on", "-mountrandom", mountRoot, "-plist", disk]);
  const mounts = [...plist.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  const device = plist.match(/<key>dev-entry<\/key>\s*<string>(\/dev\/disk\d+)<\/string>/)?.[1];
  try {
    if (mounts.length !== 1) throw new Error(`expected only the FAT partition to mount, got: ${mounts.join(", ") || "none"}`);
    fn(mounts[0]);
  } finally {
    const r = spawnSync("hdiutil", ["detach", device ?? mounts[0]], { encoding: "utf8" });
    if (r.status !== 0) spawnSync("hdiutil", ["detach", "-force", device ?? mounts[0]]);
    rmSync(mountRoot, { recursive: true, force: true });
  }
}

async function main() {
  mkdirSync(DL, { recursive: true });
  if (existsSync(PACKAGE)) {
    if (!flag("--replace")) throw new Error(`${PACKAGE} exists. Pass --replace to rebuild it (this destroys that VM's disk).`);
    say(`replacing ${PACKAGE}`);
    rmSync(PACKAGE, { recursive: true });
    rmSync(join(VM_ROOT, "ssh/known_hosts"), { force: true }); // a new VM has new host keys
  }
  const image = await fetchPinned(lock.image);
  const kernelDeb = await fetchPinned(lock.virtual.kernel_deb);
  const busyboxDeb = await fetchPinned(lock.virtual.busybox_deb);
  const nodeTarball = await fetchPinned(lock.node);
  const release = lock.virtual.kernel_release;

  const tmp = `${PACKAGE}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  const data = join(tmp, "Data");
  mkdirSync(data, { recursive: true });
  const work = mkdtempSync(join(VM_ROOT, ".work-"));
  try {
    const kernelData = debData(kernelDeb, join(work, "kernel"));
    const busyboxData = debData(busyboxDeb, join(work, "busybox"));

    tarExtract(kernelData, join(work, "boot"), [`./boot/vmlinuz-${release}`]);
    writeFileSync(join(data, "vmlinux"), unwrapZboot(readFileSync(join(work, "boot/boot", `vmlinuz-${release}`))));
    writeFileSync(join(data, "initrd"), buildInitrd({ kernelData, busyboxData, release, work: join(work, "initrd") }));
    const modulesTgz = join(work, "kernel-modules.tar.gz");
    say("packing kernel modules");
    modulesTarball(kernelData, release, modulesTgz);

    say("unpacking the Pi OS image");
    const disk = join(data, "disk.img");
    await pipeline(spawn("xz", ["-dc", image], { stdio: ["ignore", "pipe", "inherit"] }).stdout, createWriteStream(disk));
    if (statSync(disk).size > DISK_BYTES) throw new Error("image is bigger than the disk");
    truncateSync(disk, DISK_BYTES);
    const fd = openSync(disk, "r+");
    const first = Buffer.alloc(512);
    readSync(fd, first, 0, 512, 0);
    const grown = growSecondPartition(first, DISK_BYTES);
    writeSync(fd, grown, 0, 512, 0);
    closeSync(fd);
    const p1 = partition(grown, 1);
    const p2 = partition(grown, 2);
    say(`partitions: p1 type 0x${p1.type.toString(16)} ${(p1.sizeBytes / 2 ** 20).toFixed(0)} MiB, p2 ${(p2.sizeBytes / 2 ** 30).toFixed(1)} GiB`);

    withBootPartition(disk, (mount) => writeSeed(mount, { modulesTgz, nodeTarball, profile: "virtual" }));

    const config = utmConfig({ name: NAME, uuid: UUID, mac: MAC, network, bridgeInterface: bridge, cmdline: CMDLINE, serial: SERIAL });
    const json = join(work, "config.json");
    writeFileSync(json, JSON.stringify(config));
    run("plutil", ["-convert", "xml1", "-o", join(tmp, "config.plist"), json]);
    run("plutil", ["-lint", join(tmp, "config.plist")]);
    renameSync(tmp, PACKAGE);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  const used = Number(run("du", ["-sk", join(PACKAGE, "Data/disk.img")]).split(/\s+/)[0]) / 2 ** 20;
  say(`done: ${PACKAGE} (disk ${used.toFixed(1)} GiB on the mini, 32 GiB maximum). Start it with scripts/virtual-cabinet/up.sh`);
}

main().catch((err) => {
  console.error(`[build] FAILED: ${err.message}`);
  process.exit(1);
});

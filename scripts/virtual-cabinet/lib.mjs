// Pure helpers for the virtual cabinet's generator: no disk, no network, so they can be tested.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/** An IANA zone name from /etc/localtime's link target, or null. "/var/db/timezone/zoneinfo/America/New_York". */
export function zoneFromLink(target) {
  const m = /\/zoneinfo\/([A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*)$/.exec(String(target).trim());
  return m ? m[1] : null;
}

/** The mini's time zone, which every cabinet takes (D246). ARCADE_TIMEZONE overrides it. */
export function miniTimezone() {
  if (process.env.ARCADE_TIMEZONE) return process.env.ARCADE_TIMEZONE;
  try {
    return zoneFromLink(execFileSync("readlink", ["/etc/localtime"], { encoding: "utf8" })) ?? "America/New_York";
  } catch {
    return "America/New_York";
  }
}

/** What goes to a cabinet, for a build's seed and for an update (D195). */
export const BUNDLE_PATHS = ["package.json", "package-lock.json", "runtime", "studio-kit", "cabinet/service", "cabinet/vm/guest", "guests"];

const NO_MAC_FILES = { ...process.env, COPYFILE_DISABLE: "1" };
// The same files make the same archive, byte for byte: no gzip timestamp, no owner names, plain ustar.
// A cabinet names a release by the bundle's hash, so otherwise every update would make a new release (D195).
const SAME_EACH_TIME = ["--format", "ustar", "--options", "gzip:!timestamp", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root"];

/** Tracked and new files only, so nothing ignored or local gets in. Returns how many. */
export function makeBundle(repo, out) {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", ...BUNDLE_PATHS], { cwd: repo, encoding: "utf8", maxBuffer: 2 ** 26 })
    .split("\n")
    .filter((f) => f && existsSync(join(repo, f)));
  const list = join(dirname(out), `${basename(out)}.list`);
  writeFileSync(list, `${files.join("\n")}\n`);
  execFileSync("tar", ["-czf", out, ...SAME_EACH_TIME, "--no-xattrs", "--no-mac-metadata", "-C", repo, "-T", list], { env: NO_MAC_FILES });
  rmSync(list);
  return files.length;
}

/** The provisioning script and what it installs. */
export function makeProvisionTar(repo, out) {
  execFileSync("tar", ["-czf", out, ...SAME_EACH_TIME, "--no-xattrs", "--no-mac-metadata", "-C", join(repo, "cabinet/provision"), "."], { env: NO_MAC_FILES });
}

const SECTOR = 512;

/** Rewrite the MBR so its last partition (the 2nd) reaches the end of the disk. Returns a new first sector. */
export function growSecondPartition(mbr, diskBytes) {
  if (mbr.length < SECTOR || mbr[510] !== 0x55 || mbr[511] !== 0xaa) throw new Error("no MBR signature");
  const out = Buffer.from(mbr.subarray(0, SECTOR));
  const entry = 446 + 16;
  const start = out.readUInt32LE(entry + 8);
  if (start === 0) throw new Error("no second partition");
  const total = Math.floor(diskBytes / SECTOR);
  if (total <= start) throw new Error("disk smaller than the partition start");
  out.writeUInt32LE(total - start, entry + 12);
  return out;
}

/** Offset and size of an MBR partition, 1-based. */
export function partition(mbr, n) {
  const entry = 446 + 16 * (n - 1);
  return { type: mbr[entry + 4], startBytes: mbr.readUInt32LE(entry + 8) * SECTOR, sizeBytes: mbr.readUInt32LE(entry + 12) * SECTOR };
}

/**
 * Apple's Linux boot loader needs a plain arm64 Image. Debian's trixie vmlinuz
 * already is one (magic "ARM\x64" at 56). Some kernels wrap it in EFI "zboot":
 * "zimg" at 4, payload offset at 8, payload size at 12, compression name at 24.
 */
export function unwrapZboot(file) {
  if (file.subarray(56, 60).toString("latin1") === "ARM\x64") return file;
  if (file.subarray(4, 8).toString("latin1") !== "zimg") throw new Error("not an arm64 Image or zboot kernel");
  const offset = file.readUInt32LE(8);
  const size = file.readUInt32LE(12);
  const comp = file.subarray(24, 56).toString("latin1").replace(/\0.*$/s, "");
  if (comp !== "gzip") throw new Error(`zboot compression ${comp} not handled`);
  const image = gunzipSync(file.subarray(offset, offset + size));
  // arm64 Image header: magic "ARM\x64" at 56.
  if (image.subarray(56, 60).toString("latin1") !== "ARM\x64") throw new Error("payload is not an arm64 Image");
  return image;
}

/** Read one key from a kernel module's .modinfo section ("depends=a,b\0"). */
export function modinfoValues(ko, key) {
  const needle = Buffer.from(`${key}=`, "latin1");
  const values = [];
  let at = 0;
  while ((at = ko.indexOf(needle, at)) !== -1) {
    if (at === 0 || ko[at - 1] === 0) {
      const end = ko.indexOf(0, at);
      values.push(ko.subarray(at + needle.length, end).toString("latin1"));
    }
    at += needle.length;
  }
  return values;
}

export const normalizeModule = (name) => name.replace(/-/g, "_");

/**
 * Load order for a set of modules: dependencies first.
 * @param {string[]} roots
 * @param {(name: string) => string[]} dependsOf
 */
export function loadOrder(roots, dependsOf) {
  const order = [];
  const seen = new Set();
  const visit = (raw) => {
    const name = normalizeModule(raw);
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of dependsOf(name)) visit(dep);
    order.push(name);
  };
  roots.forEach(visit);
  return order;
}

/** A newc cpio archive, everything owned by root. entries: {name, mode, data?, link?} with mode including type bits. */
export function cpioNewc(entries) {
  const parts = [];
  let total = 0;
  const push = (b) => {
    parts.push(b);
    total += b.length;
  };
  const pad = () => {
    const rem = total % 4;
    if (rem) push(Buffer.alloc(4 - rem));
  };
  const hex = (n) => n.toString(16).padStart(8, "0");
  let ino = 1;
  const record = (name, mode, data) => {
    const nameBytes = Buffer.from(`${name}\0`, "utf8");
    const header = ["070701", hex(ino++), hex(mode), hex(0), hex(0), hex(1), hex(0), hex(data.length), hex(0), hex(0), hex(0), hex(0), hex(nameBytes.length), hex(0)].join("");
    push(Buffer.from(header, "latin1"));
    push(nameBytes);
    pad();
    push(data);
    pad();
  };
  for (const e of entries) record(e.name, e.mode, e.link ? Buffer.from(e.link, "utf8") : (e.data ?? Buffer.alloc(0)));
  record("TRAILER!!!", 0, Buffer.alloc(0));
  return Buffer.concat(parts);
}

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
export const dir = (name) => ({ name, mode: S_IFDIR | 0o755 });
export const file = (name, data, perm = 0o644) => ({ name, mode: S_IFREG | perm, data });
export const link = (name, target) => ({ name, mode: S_IFLNK | 0o777, link: target });

/** The second card's fixed MAC: the mini's own way in, on the shared network (D241). */
export const MINI_LINK_MAC = "5a:47:41:43:41:43";

/** The cards for a network choice. "Both": bridged for the cabinet (D152), shared for the mini (D241). */
export function networkCards(network, mac, bridgeInterface) {
  const bridged = { Mode: "Bridged", MacAddress: mac, BridgeInterface: bridgeInterface };
  if (network === "Bridged") return [bridged];
  if (network === "Shared") return [{ Mode: "Shared", MacAddress: mac }];
  if (network === "Both") return [bridged, { Mode: "Shared", MacAddress: MINI_LINK_MAC }];
  throw new Error(`unknown network ${network}`);
}

const macKey = (mac) => mac.toLowerCase().split(":").map((o) => o.replace(/^0(?=.)/, "")).join(":");

/** The address macOS's DHCP server gave a MAC, from /var/db/dhcpd_leases' text. It drops leading zeros there. */
export function leaseFor(text, mac) {
  const want = macKey(mac);
  for (const block of text.split("}")) {
    const ip = block.match(/^\s*ip_address=(\S+)/m)?.[1];
    const hw = block.match(/^\s*hw_address=\d+,(\S+)/m)?.[1];
    if (ip && hw && macKey(hw) === want) return ip;
  }
  return null;
}

/** The UTM 5 config for D123, with no display (D141). Same input, same config. */
export function utmConfig({ name, uuid, mac, network, bridgeInterface, cmdline, serial = false, cpus = 4, memoryMb = 8192 }) {
  return {
    Backend: "Apple",
    ConfigurationVersion: 4,
    Information: { Name: name, UUID: uuid, Icon: "linux", IconCustom: false, Notes: "Virtual cabinet. Generated by scripts/virtual-cabinet; edit there." },
    System: {
      Architecture: "aarch64",
      CPUCount: cpus,
      MemorySize: memoryMb,
      Boot: {
        OperatingSystem: "Linux",
        UEFIBoot: false,
        SecureBoot: false,
        LinuxKernelPath: "vmlinux",
        LinuxInitialRamdiskPath: "initrd",
        LinuxCommandLine: cmdline,
      },
      GenericPlatform: {},
    },
    Virtualization: {
      Audio: true,
      AudioInput: false, // never ask for the microphone (D141); passthrough comes with D127
      Balloon: false,
      Entropy: true,
      Keyboard: "Generic",
      Pointer: "Mouse",
      Trackpad: false,
      Rosetta: false,
      ClipboardSharing: false,
    },
    Display: [],
    Drive: [{ Identifier: "A7C3F1E2-0D4B-4E6A-9B21-3C5D7E9F1A2B", ImageName: "disk.img", ReadOnly: false, Nvme: false }],
    Network: networkCards(network, mac, bridgeInterface),
    // No serial device unless debugging: an unread one freezes the guest (D148).
    Serial: serial ? [{ Mode: "Ptty" }] : [],
  };
}

/** The D82 keys, by the names the driver uses. */
export const KEYS = {
  up: 103, down: 108, left: 105, right: 106,
  a: 44, b: 45, x: 46, y: 47,
  q: 16, e: 18,
  start: 28, enter: 28,
  esc: 1, star: 1,
  f1: 59, f2: 60,
};

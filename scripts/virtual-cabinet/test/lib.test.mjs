import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { growSecondPartition, partition, unwrapZboot, modinfoValues, loadOrder, cpioNewc, dir, file, link, utmConfig, KEYS } from "../lib.mjs";

function mbr(start2, size2) {
  const b = Buffer.alloc(512);
  b.writeUInt32LE(start2, 446 + 16 + 8);
  b.writeUInt32LE(size2, 446 + 16 + 12);
  b[510] = 0x55;
  b[511] = 0xaa;
  return b;
}

test("growing the second partition reaches the end of a 32 GiB disk", () => {
  const out = growSecondPartition(mbr(1064960, 4000000), 32 * 2 ** 30);
  const p = partition(out, 2);
  assert.equal(p.startBytes + p.sizeBytes, 32 * 2 ** 30);
  assert.equal(p.startBytes, 1064960 * 512);
});

test("growing refuses a disk without an MBR", () => {
  assert.throws(() => growSecondPartition(Buffer.alloc(512), 1e9), /no MBR/);
});

test("unwrapZboot returns the arm64 Image and rejects anything else", () => {
  const image = Buffer.alloc(128);
  image.write("ARM\x64", 56, "latin1");
  const gz = gzipSync(image);
  const head = Buffer.alloc(64);
  head.write("zimg", 4, "latin1");
  head.writeUInt32LE(64, 8);
  head.writeUInt32LE(gz.length, 12);
  head.write("gzip", 24, "latin1");
  assert.deepEqual(unwrapZboot(Buffer.concat([head, gz])), image);
  assert.deepEqual(unwrapZboot(image), image, "a plain Image passes through");
  assert.throws(() => unwrapZboot(Buffer.alloc(64)), /not an arm64 Image/);
});

test("modinfo values need a NUL or the start before the key", () => {
  const ko = Buffer.from("xdepends=no\0license=GPL\0depends=jbd2,mbcache\0", "latin1");
  assert.deepEqual(modinfoValues(ko, "depends"), ["jbd2,mbcache"]);
});

test("load order puts dependencies first and visits each once", () => {
  const deps = { ext4: ["jbd2", "crc16", "mbcache"], jbd2: ["crc16"], vfat: ["fat"] };
  const order = loadOrder(["ext4", "vfat"], (n) => deps[n] ?? []);
  assert.deepEqual(order, ["crc16", "jbd2", "mbcache", "ext4", "fat", "vfat"]);
});

test("the system cpio reads back our newc archive", () => {
  const archive = cpioNewc([dir("bin"), file("bin/x", Buffer.from("hello"), 0o755), link("sh", "bin/x")]);
  const at = mkdtempSync(join(tmpdir(), "cpio-"));
  writeFileSync(join(at, "a.cpio"), archive);
  const listing = execFileSync("tar", ["-tvf", join(at, "a.cpio")], { encoding: "utf8" });
  assert.match(listing, /bin\/x/);
  assert.match(listing, /sh -> bin\/x/);
  assert.equal(execFileSync("tar", ["-xOf", join(at, "a.cpio"), "bin/x"], { encoding: "utf8" }), "hello");
});

test("the VM config matches D123 and D141", () => {
  const c = utmConfig({ name: "arcade-virtual", uuid: "u", mac: "m", network: "Bridged", bridgeInterface: "en1", cmdline: "c" });
  assert.equal(c.System.CPUCount, 4);
  assert.equal(c.System.MemorySize, 8192);
  assert.deepEqual(c.Display, []);
  assert.equal(c.Virtualization.ClipboardSharing, false);
  assert.equal(c.Virtualization.Rosetta, false);
  assert.equal(c.Virtualization.AudioInput, false);
  assert.equal(c.SharedDirectory, undefined);
  assert.deepEqual(c.Serial, [], "an unread serial device freezes the guest (D148)");
  assert.equal(utmConfig({ name: "n", uuid: "u", mac: "m", network: "Shared", cmdline: "c", serial: true }).Serial.length, 1);
  assert.equal(c.Network[0].BridgeInterface, "en1");
  assert.equal(utmConfig({ name: "n", uuid: "u", mac: "m", network: "Shared", cmdline: "c" }).Network[0].BridgeInterface, undefined);
});

test("the driver's keys are D82's", () => {
  assert.deepEqual([KEYS.a, KEYS.b, KEYS.x, KEYS.y, KEYS.start, KEYS.esc, KEYS.up], [44, 45, 46, 47, 28, 1, 103]);
});

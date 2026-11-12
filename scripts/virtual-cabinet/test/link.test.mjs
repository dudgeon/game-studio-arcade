// The mini's private card (D241): the config it adds, the address it finds, and the edit to an existing VM.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leaseFor, MINI_LINK_MAC, networkCards, utmConfig } from "../lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINI_LINK = path.join(HERE, "../mini-link.sh");
const VM_ADDR = path.join(HERE, "../vm-addr.mjs");
const MAC = "5a:47:41:43:41:42";

const LEASES = `{
	name=other-vm
	ip_address=192.168.64.2
	hw_address=1,a:b:c:d:e:f
	identifier=1,a:b:c:d:e:f
	lease=0x6a1b2c3d
}
{
	name=arcade-virtual
	ip_address=192.168.64.7
	hw_address=1,5a:47:41:43:41:43
	identifier=1,5a:47:41:43:41:43
	lease=0x6a1b2c3e
}
`;

test("Both gives a bridged card first and the mini's shared card second", () => {
  assert.deepEqual(networkCards("Both", MAC, "en1"), [
    { Mode: "Bridged", MacAddress: MAC, BridgeInterface: "en1" },
    { Mode: "Shared", MacAddress: MINI_LINK_MAC },
  ]);
  assert.notEqual(MINI_LINK_MAC, MAC);
  assert.deepEqual(networkCards("Bridged", MAC, "en1"), [{ Mode: "Bridged", MacAddress: MAC, BridgeInterface: "en1" }]);
  assert.deepEqual(networkCards("Shared", MAC, "en1"), [{ Mode: "Shared", MacAddress: MAC }]);
  assert.throws(() => networkCards("Host", MAC, "en1"));
  assert.equal(utmConfig({ name: "n", uuid: "u", mac: MAC, network: "Both", bridgeInterface: "en1", cmdline: "c" }).Network.length, 2);
});

test("a lease is found by MAC, with macOS's dropped leading zeros", () => {
  assert.equal(leaseFor(LEASES, MINI_LINK_MAC), "192.168.64.7");
  assert.equal(leaseFor(LEASES, "0a:0b:0c:0d:0e:0f"), "192.168.64.2");
  assert.equal(leaseFor(LEASES, MAC), null);
  assert.equal(leaseFor("", MAC), null);
});

test("vm-addr prints the private card's address, or fails with nothing yet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leases-"));
  const file = path.join(dir, "dhcpd_leases");
  fs.writeFileSync(file, LEASES);
  assert.equal(execFileSync(process.execPath, [VM_ADDR], { encoding: "utf8", env: { ...process.env, GSA_DHCP_LEASES: file } }).trim(), "192.168.64.7");
  const none = spawnSync(process.execPath, [VM_ADDR], { encoding: "utf8", env: { ...process.env, GSA_DHCP_LEASES: path.join(dir, "absent") } });
  assert.equal(none.status, 1);
  assert.equal(none.stdout, "");
});

function vm() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-"));
  const pkg = path.join(root, "arcade-virtual.utm");
  fs.mkdirSync(pkg);
  const json = path.join(root, "c.json");
  fs.writeFileSync(json, JSON.stringify(utmConfig({ name: "arcade-virtual", uuid: "u", mac: MAC, network: "Bridged", bridgeInterface: "en1", cmdline: "console=tty0 root=/dev/vda2 rw" })));
  execFileSync("plutil", ["-convert", "xml1", "-o", path.join(pkg, "config.plist"), json]);
  return { root, config: path.join(pkg, "config.plist") };
}
const linkRun = (root, args, utmRunning) =>
  spawnSync("/bin/bash", [MINI_LINK, ...args], { encoding: "utf8", env: { ...process.env, GSA_VM_DIR: root, GSA_PGREP: utmRunning ? "true" : "false" } });
const read = (config) => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", config], { encoding: "utf8" }));

test("mini-link adds the card to an existing VM, keeps everything else and a copy, and is safe to repeat", () => {
  const { root, config } = vm();
  const before = read(config);
  assert.equal(linkRun(root, ["--check"]).stdout.trim(), "doesn't have it");
  const r = linkRun(root, [], false);
  assert.equal(r.status, 0, r.stderr);
  const after = read(config);
  assert.deepEqual(after.Network, networkCards("Both", MAC, "en1"));
  assert.deepEqual({ ...after, Network: null }, { ...before, Network: null }, "nothing else changed");
  const copies = fs.readdirSync(path.dirname(config)).filter((f) => f.startsWith("config.plist.before-mini-link-"));
  assert.equal(copies.length, 1);
  assert.deepEqual(read(path.join(path.dirname(config), copies[0])), before);
  assert.equal(linkRun(root, ["--check"]).stdout.trim(), "has it");
  const again = linkRun(root, [], false);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already/);
  assert.equal(read(config).Network.length, 2);
});

// The virtual profile's pieces, printed by sourcing it (it only defines things until provision.sh calls them).
const PROFILE = path.join(HERE, "../../../cabinet/provision/profiles/virtual.sh");
const profile = (call) => execFileSync("/bin/bash", ["-c", `source "$0"; ${call}`, PROFILE], { encoding: "utf8" });

test("the cabinet's card for the mini never becomes its way out", () => {
  const k = profile("mini_link_keyfile");
  assert.match(k, new RegExp(`^mac-address=${MINI_LINK_MAC}$`, "im"));
  for (const line of ["never-default=true", "ignore-auto-dns=true", "ignore-auto-routes=true", "method=disabled"]) assert.ok(k.split("\n").includes(line), line);
});

test("NetworkManager doesn't treat the bridge's MAC NAT as an address conflict (D245), on the virtual profile only", () => {
  assert.equal(profile("nm_no_acd_conf"), "[connection-arcade-no-acd]\nipv4.dad-timeout=0\n");
  const p = fs.readFileSync(PROFILE, "utf8");
  assert.ok(/hw_late\(\) \{[^}]*step_no_acd/.test(p));
  assert.ok(!fs.readFileSync(path.join(path.dirname(PROFILE), "picade.sh"), "utf8").includes("dad-timeout"), "a conflict on the Picade is real");
});

test("the firewall refuses new connections out to the shared network, apart from DHCP, mDNS and DNS", () => {
  const rules = profile('firewall_rules "192.168.86.96,192.168.64.1" "fd00::1"').split("\n").map((l) => l.trim());
  const link = rules.indexOf("ip daddr 192.168.64.0/24 ct state new counter reject");
  assert.ok(link > 0);
  assert.ok(rules.indexOf("ip daddr 192.168.64.0/24 udp dport { 53, 67, 5353 } accept") < link, "a shared-only VM still gets DHCP and DNS");
  assert.ok(rules.includes("ip daddr { 192.168.86.96,192.168.64.1 } ct state new counter reject"), "D124's rule for the mini's own addresses stays");
  assert.ok(rules.includes("ip6 daddr { fd00::1 } ct state new counter reject"));
  assert.ok(profile('firewall_rules "" ""').includes("192.168.64.0/24 ct state new counter reject"), "even with no seeded addresses");
});

test("every verify.sh check has a space between its runner and its quoted command", () => {
  const verify = fs.readFileSync(path.join(HERE, "../verify.sh"), "utf8");
  const glued = verify.split("\n").filter((l) => /^check \S+ \w+'/.test(l));
  assert.deepEqual(glued, [], "a quote glued to the runner's name makes bash run a command that doesn't exist");
});

test("mini-link won't touch the config while UTM is running, since UTM would keep its cached copy", () => {
  const { root, config } = vm();
  const before = fs.readFileSync(config);
  const r = linkRun(root, [], true);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /quit UTM/);
  assert.deepEqual(fs.readFileSync(config), before);
  assert.equal(fs.readdirSync(path.dirname(config)).length, 1, "no copy made either");
});

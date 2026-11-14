// The Picade's card (D250-D256): the safety checks on the disk, the files on the card, and the picade profile's
// config.txt, sound and input files. No card and no network. The full write to an image file is image-file.sh,
// run with GSA_CARD_E2E=1, because it writes 3 GB.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK_CONFIG_APPLIED, SEED_FILES, confirmPhrase, lockedWheels, describe, metaData, networkConfig, profileHostname, refusals, sameDisk, shellQuote, userData, wifiPsk } from "../lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const PROFILE = path.join(REPO, "cabinet/provision/profiles/picade.sh");
const FLASH = path.join(REPO, "scripts/cabinet-card/flash.mjs");
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGVmYWtla2V5Zm9ydGVzdHNvbmx5bm90cmVhbDEyMzQ1 picade-cabinet-admin";
const mac = process.platform === "darwin";

/** A card in a USB reader, as diskutil describes one. */
const CARD = {
  DeviceIdentifier: "disk4",
  WholeDisk: true,
  Internal: false,
  VirtualOrPhysical: "Physical",
  BusProtocol: "USB",
  RemovableMedia: true,
  Ejectable: true,
  WritableMedia: true,
  TotalSize: 31_914_983_424,
  MediaName: "Card Reader",
  IORegistryEntryName: "SD Card Reader Media",
  DiskUUID: "",
};

test("the WPA key is wpa_passphrase's: IEEE 802.11i's test vector", () => {
  assert.equal(wifiPsk("IEEE", "password"), "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e");
  assert.equal(wifiPsk("ThisIsASSID", "ThisIsAPassword"), "0dc0d6eb90555ed6419756b9a15ec3e3209b63df707dd508d14581f8982721af");
  const hex = "AB".repeat(32);
  assert.equal(wifiPsk("x", hex), hex.toLowerCase(), "a 64-hex key is already a key");
  assert.throws(() => wifiPsk("x", "short"), /8 to 63/);
  assert.throws(() => wifiPsk("x", "g".repeat(64)), /8 to 63/);
  assert.throws(() => wifiPsk("x", "pässwörd1"), /printable ASCII/);
  assert.throws(() => wifiPsk("", "password"), /1 to 32/);
  assert.throws(() => wifiPsk("x".repeat(33), "password"), /1 to 32/);
});

test("network-config holds the WPA key, never the password, and quotes any network name (D251)", () => {
  const ssid = 'Our "Mesh": Café #2';
  const psk = wifiPsk(ssid, "correct horse battery");
  const text = networkConfig({ ssid, psk, country: "US" });
  assert.ok(!text.includes("correct horse battery"));
  assert.match(text, /^network:$/m);
  assert.match(text, /renderer: NetworkManager/);
  assert.match(text, /\n  ethernets:\n    eth0:\n      dhcp4: true\n      optional: true\n      networkmanager:\n        passthrough:\n          ipv4.dhcp-timeout: "2147483647"\n          ipv6.method: "link-local"\n  wifis:\n/, "a cable works too, no boot waits for one (D393), and DHCP on it never gives up, with link-local IPv6 (D398)");
  assert.match(text, /regulatory-domain: "US"/);
  const nameLine = text.split("\n").find((l) => l.endsWith(":") && l.trim().startsWith('"'));
  assert.equal(JSON.parse(nameLine.trim().slice(0, -1)), ssid, "the name survives quoting");
  assert.match(text, new RegExp(`password: "${psk}"`));
  assert.throws(() => networkConfig({ ssid, psk: "short", country: "US" }), /64 hex/);
  assert.match(networkConfig({ ssid, psk: "a WPA3 passphrase", country: "US" }), /password: "a WPA3 passphrase"/, "--wpa3");
  assert.throws(() => networkConfig({ ssid, psk, country: "usa" }), /two-letter/);
});

test("user-data makes the admin with the mini's key, plants the seed service, and replaces network-config (D250)", () => {
  const text = userData({ hostname: "arcade", timezone: "America/New_York", locale: "en_US.UTF-8", authorizedKey: KEY, country: "US" });
  const lines = text.split("\n");
  assert.equal(lines[0], "#cloud-config", "cloud-init ignores a file without it");
  assert.match(text, /^hostname: arcade$/m);
  assert.match(text, /^enable_ssh: true$/m);
  assert.match(text, /^ssh_pwauth: false$/m);
  assert.match(text, /^ {2}- name: cabinet$/m);
  assert.match(text, /^ {4}lock_passwd: true$/m);
  assert.ok(text.includes(JSON.stringify(KEY)));
  assert.ok(!/(^|\s)(plain_text_passwd|hashed_passwd|passwd|password):/m.test(text), "no password for anyone");
  const bootcmd = lines.slice(lines.indexOf("bootcmd:") + 1, lines.indexOf("runcmd:"));
  assert.ok(bootcmd.some((l) => /systemctl mask systemd-networkd-wait-online\.service; systemctl stop --no-block systemd-networkd-wait-online\.service/.test(l)), "first boot mustn't sit 2 minutes on networkd (D244)");
  const country = bootcmd.map((l) => JSON.parse(l.replace(/^ {2}- \[sh, -c, /, "").replace(/\]$/, ""))).find((c) => c.includes("do_wifi_country"));
  assert.equal(country, "cloud-init-per once arcade-wifi-country sh -c 'raspi-config nonint do_wifi_country US || true; rfkill unblock wifi || true'", "the country is set once per card, not on every boot (D398)");
  const runcmd = lines.slice(lines.indexOf("runcmd:") + 1).filter((l) => l.startsWith("  - "));
  assert.equal(runcmd.length, 2);
  const cmd = (l) => JSON.parse(l.replace(/^ {2}- \[sh, -c, /, "").replace(/\]$/, ""));
  assert.match(cmd(runcmd[0]), /> \/boot\/firmware\/network-config$/);
  assert.match(cmd(runcmd[1]), /install -m 0644 \/boot\/firmware\/seed\/arcade-seed\.service \/etc\/systemd\/system\/arcade-seed\.service/);
  assert.match(cmd(runcmd[1]), /systemctl enable arcade-seed\.service && systemctl start --no-block arcade-seed\.service$/);
  // The overwrite really writes the "applied" note, through sh's quoting.
  const out = execFileSync("/bin/sh", ["-c", cmd(runcmd[0]).replace("/boot/firmware/network-config", "/dev/stdout")], { encoding: "utf8" });
  assert.equal(out, NETWORK_CONFIG_APPLIED);
  for (const bad of [{ hostname: "Arcade" }, { timezone: "x; rm -rf /" }, { locale: "en_US" }, { authorizedKey: "ssh-rsa AAAA" }, { authorizedKey: `${KEY}\nssh-ed25519 AAAA` }, { country: "us" }]) {
    assert.throws(() => userData({ hostname: "arcade", timezone: "UTC", locale: "en_US.UTF-8", authorizedKey: KEY, country: "US", ...bad }));
  }
});

test("meta-data names a new instance, and the hostname comes from the picade profile", () => {
  assert.match(metaData("arcade-20261111T1700-abc123"), /^instance-id: arcade-20261111T1700-abc123$/m);
  assert.doesNotMatch(metaData("x"), /instance_id/, "cloud-init reads instance-id, not instance_id");
  assert.throws(() => metaData("a b"));
  assert.equal(profileHostname(fs.readFileSync(PROFILE, "utf8")), "arcade");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("a card in a reader may be written; everything else is refused, with the reason (D250)", () => {
  assert.deepEqual(refusals(CARD), []);
  const no = (over, re, opts) => {
    const why = refusals({ ...CARD, ...over }, opts);
    assert.ok(why.some((w) => re.test(w)), `${JSON.stringify(over)}: ${why.join("; ")}`);
  };
  no({ DeviceIdentifier: "disk4s1", WholeDisk: false }, /whole disk/);
  no({ Internal: true }, /internal/);
  no({ VirtualOrPhysical: "Virtual", BusProtocol: "Disk Image" }, /physical/);
  no({ BusProtocol: "Apple Fabric" }, /not a card reader/);
  no({ BusProtocol: "Thunderbolt" }, /not a card reader/);
  no({ RemovableMedia: false, Ejectable: false, Removable: false }, /removable/);
  no({ TotalSize: 4e9 }, /4\.0 GB/);
  no({ TotalSize: 1e12 }, /1000\.0 GB/);
  no({ WritableMedia: false }, /read-only/);
  no({}, /mini's own system/, { bootWholeDisks: ["disk4"] });
  assert.deepEqual(refusals({ ...CARD, BusProtocol: "Secure Digital" }), [], "the built-in reader of some Macs");
});

test("the confirmation names the disk and its size; a swapped card isn't the same disk", () => {
  assert.equal(confirmPhrase(CARD), "erase disk4 32GB");
  assert.ok(sameDisk(CARD, { ...CARD }));
  assert.ok(!sameDisk(CARD, { ...CARD, TotalSize: 63_864_569_856 }));
  assert.ok(!sameDisk(CARD, { ...CARD, DeviceIdentifier: "disk5" }));
  const lines = describe(CARD, [{ DeviceIdentifier: "disk4s1", VolumeName: "bootfs", Size: 536_870_912, MountPoint: "/Volumes/bootfs" }, { DeviceIdentifier: "disk4s2", Content: "Linux", Size: 31e9 }]);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /disk4s1 {2}bootfs {2}0\.5 GB {2}mounted at \/Volumes\/bootfs/);
  assert.match(lines[2], /disk4s2 {2}Linux/);
});

test("the mini's own disks are refused as diskutil really describes them", { skip: !mac && "macOS only" }, () => {
  const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: execFileSync("diskutil", ["info", "-plist", "/"]) }).toString());
  const why = refusals(info);
  assert.ok(why.some((w) => /internal/.test(w)), why.join("; "));
  const disk0 = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: execFileSync("diskutil", ["info", "-plist", "disk0"]) }).toString());
  assert.ok(refusals(disk0).length > 0);
});

test("an attached disk image of a card's size is refused: it isn't physical", { skip: !mac && "macOS only" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-refuse-"));
  const img = path.join(dir, "fake-card.img");
  fs.closeSync(fs.openSync(img, "w"));
  fs.truncateSync(img, 16e9); // sparse
  const out = execFileSync("hdiutil", ["attach", "-imagekey", "diskimage-class=CRawDiskImage", "-nomount", "-nobrowse", img], { encoding: "utf8" });
  const dev = out.trim().split(/\s+/)[0].replace("/dev/", "");
  try {
    const r = spawnSync(process.execPath, [FLASH, "--disk", dev], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(r.status, 1);
    // Not from a terminal, so it stops before looking at the disk; the checks themselves:
    const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: execFileSync("diskutil", ["info", "-plist", dev]) }).toString());
    const why = refusals(info);
    assert.ok(why.some((w) => /physical/.test(w)), why.join("; "));
    assert.equal(fs.statSync(img).blocks, 0, "nothing was written to it");
  } finally {
    spawnSync("hdiutil", ["detach", dev]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flash.mjs needs one target, and won't write a card with no terminal", () => {
  const none = spawnSync(process.execPath, [FLASH], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /name one target/);
  const both = spawnSync(process.execPath, [FLASH, "--disk", "disk9", "--image-file", "/tmp/x.img"], { encoding: "utf8" });
  assert.match(both.stderr, /name one target/);
  const noTty = spawnSync(process.execPath, [FLASH, "--disk", "disk9"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  assert.equal(noTty.status, 1);
  assert.match(noTty.stderr, /Terminal window/);
});

// ---- The picade profile ----

/** provision.sh's helpers and the profile in a bash, with GNU sed -i's form on BSD sed. */
function profileBash(script, env = {}) {
  const shim = `sed() { if [ "$1" = -i ]; then shift; local f="\${@: -1}"; local n=$(($#-1)); command sed "\${@:1:$n}" "$f" > "$f.tmp" && mv "$f.tmp" "$f"; else command sed "$@"; fi; }
log() { echo "[provision] $*"; }
SELF_DIR=${JSON.stringify(path.join(REPO, "cabinet/provision"))}
. ${JSON.stringify(PROFILE)}
${script}`;
  return execFileSync("/bin/bash", ["-c", shim], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("config.txt: one block of ours under [all], the key map of D82, and the stock audio lines turned off (D83, D253)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-config-"));
  const file = path.join(dir, "config.txt");
  fs.copyFileSync(path.join(HERE, "fixtures/config.txt"), file);
  const flag = path.join(dir, "reboot");
  profileBash(`REBOOT_FLAG=${JSON.stringify(flag)}; step_config_txt ${JSON.stringify(file)}`);
  assert.ok(fs.existsSync(flag), "a changed config.txt asks for the one restart");
  fs.rmSync(flag);
  profileBash(`REBOOT_FLAG=${JSON.stringify(flag)}; step_config_txt ${JSON.stringify(file)}`);
  assert.ok(!fs.existsSync(flag), "running again changes nothing, so no restart");
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.match(/# BEGIN arcade provision/g)?.length, 1, "running twice leaves one block");
  assert.match(text, /^dtoverlay=vc4-kms-v3d,noaudio$/m);
  assert.doesNotMatch(text, /^dtparam=audio=on$/m);
  const block = text.slice(text.indexOf("# BEGIN arcade provision"));
  const lines = block.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.equal(lines[0], "[all]", "a later [pi5] or [cm5] section can't swallow our lines");
  assert.ok(lines.indexOf("dtoverlay=picade") < lines.indexOf("dtparam=button1=44"), "dtparam lines after the overlay apply to it");
  const keys = Object.fromEntries(lines.filter((l) => l.startsWith("dtparam=") && l !== "dtparam=audio=off").map((l) => l.slice(8).split("=")));
  assert.deepEqual(keys, { button1: "44", button2: "45", button3: "46", button4: "47", button5: "16", button6: "18", start: "28", escape: "1", enter: "59", coin: "60" });
  assert.ok(lines.includes("usb_max_current_enable=1"));
  // Every parameter we set is one the overlay at the pinned commit has (its __overrides__).
  const overrides = ["up", "down", "left", "right", "button1", "button2", "button3", "button4", "button5", "button6", "enter", "escape", "coin", "start"];
  for (const k of Object.keys(keys)) assert.ok(overrides.includes(k), k);
  // The stock text above our block is untouched apart from the two audio lines.
  const stock = fs.readFileSync(path.join(HERE, "fixtures/config.txt"), "utf8").replace("dtoverlay=vc4-kms-v3d\n", "dtoverlay=vc4-kms-v3d,noaudio\n").replace("dtparam=audio=on\n", "dtparam=audio=off\n");
  assert.equal(text.slice(0, text.indexOf("# BEGIN arcade provision")), stock);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("config.txt: our block is replaced where it stands, so the boot slot's block stays last; unchanged means no write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-config-inplace-"));
  const file = path.join(dir, "config.txt");
  const flag = path.join(dir, "reboot");
  const run = () => profileBash(`REBOOT_FLAG=${JSON.stringify(flag)}; step_config_txt ${JSON.stringify(file)}`);
  fs.copyFileSync(path.join(HERE, "fixtures/config.txt"), file);
  run();
  const slot = "# BEGIN arcade boot slot (D336)\n[all]\nos_prefix=arcade-20261114145434/\n# END arcade boot slot (D336)\n";
  fs.appendFileSync(file, slot);
  fs.rmSync(flag);
  const before = fs.readFileSync(file, "utf8");
  const old = new Date("2026-01-01T00:00:00Z");
  fs.utimesSync(file, old, old);
  run();
  assert.equal(fs.readFileSync(file, "utf8"), before, "the same text");
  assert.equal(fs.statSync(file).mtimeMs, old.getTime(), "not written at all");
  assert.ok(!fs.existsSync(flag), "no restart wanted");
  // An older block (a line missing) is brought up to date in place, ahead of the slot block.
  fs.writeFileSync(file, before.replace("usb_max_current_enable=1\n", ""));
  run();
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.ok(fs.existsSync(flag), "a real change asks for the restart");
  assert.ok(fs.readFileSync(file, "utf8").endsWith(slot), "the slot block stays last");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("hardening: a capped persistent journal, cloud-init off, each once; the gadget overlay only in our block (D395, D396)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-harden-"));
  const env = { HARDEN_ETC: dir, HARDEN_TEST: "1" };
  const first = profileBash("step_journal_persistent; step_cloud_init_off", env);
  assert.match(first, /journal: persistent, at most 50 MB/);
  assert.match(first, /cloud-init: off after first boot/);
  assert.equal(fs.readFileSync(path.join(dir, "systemd/journald.conf.d/90-arcade-persistent.conf"), "utf8"), "[Journal]\nStorage=persistent\nSystemMaxUse=50M\n");
  assert.ok(fs.existsSync(path.join(dir, "cloud/cloud-init.disabled")));
  assert.equal(profileBash("step_journal_persistent; step_cloud_init_off", env), "", "running again changes and says nothing");
  // rpi-usb-gadget appends its overlay after our block; ours keeps the only copy, and the stock host-mode line stays.
  const cfg = path.join(dir, "config.txt");
  fs.copyFileSync(path.join(HERE, "fixtures/config.txt"), cfg);
  fs.appendFileSync(cfg, "[cm5]\ndtoverlay=dwc2,dr_mode=host\n");
  profileBash(`REBOOT_FLAG=${JSON.stringify(path.join(dir, "reboot"))}; step_config_txt ${JSON.stringify(cfg)}`);
  fs.appendFileSync(cfg, "dtoverlay=dwc2,dr_mode=peripheral\n");
  profileBash(`dedupe_gadget_overlay ${JSON.stringify(cfg)}`);
  const text = fs.readFileSync(cfg, "utf8");
  assert.equal(text.match(/^dtoverlay=dwc2,dr_mode=peripheral$/gm)?.length, 1);
  assert.ok(text.indexOf("dtoverlay=dwc2,dr_mode=peripheral") < text.indexOf("# END arcade provision"), "the copy left is ours");
  assert.match(text, /^dtoverlay=dwc2,dr_mode=host$/m);
  assert.ok(text.endsWith("# END arcade provision\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Tailscale: the version pinned in lock.json, the key checked by its fingerprint, and no sign-in by script (D397)", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, "cabinet/provision/lock.json"), "utf8"));
  assert.match(lock.picade.tailscale_version, /^\d+\.\d+\.\d+$/);
  // Already at the pinned version: nothing downloaded or installed, tailscaled enabled.
  const seen = path.join(os.tmpdir(), `card-tailscale-${process.pid}`);
  const out = profileBash(`dpkg-query() { echo ${lock.picade.tailscale_version}; }; curl() { echo CURL; }; apt-get() { echo APT; }; systemctl() { echo "systemctl $*" > ${JSON.stringify(seen)}; }; step_tailscale`);
  assert.doesNotMatch(out, /CURL|APT/);
  assert.equal(fs.readFileSync(seen, "utf8"), "systemctl enable --now tailscaled\n");
  fs.rmSync(seen);
  assert.match(out, new RegExp(`tailscale: ${lock.picade.tailscale_version.replaceAll(".", "\\.")}, tailscaled running`));
  // A key with another fingerprint: refused, nothing installed.
  const bad = profileBash(`dpkg-query() { :; }; curl() { :; }; rm() { :; }; gpg() { echo "fpr:::::::::0000000000000000000000000000000000000000:"; }; mv() { echo MV; }; apt-get() { echo APT; }; systemctl() { :; }; step_tailscale`);
  assert.match(bad, /the signing key isn't Tailscale's/);
  assert.doesNotMatch(bad, /MV|APT/);
  const src = fs.readFileSync(path.join(REPO, "cabinet/provision/harden.sh"), "utf8");
  assert.doesNotMatch(src.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /tailscale up|authkey/, "the sign-in is a person's");
  assert.match(src, /TAILSCALE_KEY_FPR=2596A99EAAB33821893C0A79458CA832957F5868/);
});

test("the profile's D82 keys match the runtime's driver keys", async () => {
  const { KEYS } = await import("../../virtual-cabinet/lib.mjs");
  const block = profileBash("config_block");
  const get = (k) => Number(block.match(new RegExp(`^dtparam=${k}=(\\d+)$`, "m"))?.[1]);
  assert.equal(get("button1"), KEYS.a);
  assert.equal(get("button2"), KEYS.b);
  assert.equal(get("button3"), KEYS.x);
  assert.equal(get("button4"), KEYS.y);
  assert.equal(get("button5"), KEYS.q);
  assert.equal(get("button6"), KEYS.e);
  assert.equal(get("start"), KEYS.start);
  assert.equal(get("escape"), KEYS.esc);
  assert.equal(get("enter"), KEYS.f1);
  assert.equal(get("coin"), KEYS.f2);
});

test("sound goes to the X HAT's DAC by name, and the overlay's keys count as a keyboard (D253)", () => {
  const alsa = profileBash("asound_conf");
  assert.doesNotMatch(alsa, /card 0/, "a USB mic can be card 0");
  assert.match(alsa, /pcm\.!default/);
  for (const l of alsa.split("\n").filter((x) => /^\s*card /.test(x))) assert.match(l, /card sndrpihifiberry$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-udev-"));
  const rule = profileBash(`UDEV_RULES=${JSON.stringify(path.join(dir, "rule"))}; step_input_rule; cat "$UDEV_RULES"`);
  assert.equal(rule, 'SUBSYSTEM=="input", ATTRS{name}=="gpio_keys", ENV{ID_INPUT_KEYBOARD}="1"\n', "Pimoroni's rule, as its installer writes it");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("with no key the Picade plays offline; with one, provision.sh uses the config (D252)", () => {
  assert.equal(profileBash("service_args_without_key").trim(), "--offline");
});

test("the seed list matches what build.mjs's seed has, less what only a VM needs", () => {
  const build = fs.readFileSync(path.join(REPO, "scripts/virtual-cabinet/build.mjs"), "utf8");
  const vmOnly = new Set(["kernel-modules.tar.gz", "mini-addrs"]);
  const inBuild = [...build.matchAll(/join\(seed, "([^"]+)"\)/g)].map((m) => m[1]).filter((n) => !vmOnly.has(n));
  assert.deepEqual([...inBuild].sort(), [...SEED_FILES].sort());
});

test("first boot puts each provisioning stage on the screen, and says so when it stops (D257)", () => {
  const prov = fs.readFileSync(path.join(REPO, "cabinet/provision/provision.sh"), "utf8");
  const declared = Number(prov.match(/^STAGES=(\d+)$/m)?.[1]);
  assert.equal((prov.match(/^stage "/gm) ?? []).length, declared, "STAGES counts every stage");
  const run = (exitCode, { tick = "30", slow = 0, reboot = false } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "card-firstboot-"));
    const seed = path.join(root, "seed");
    const src = path.join(root, "src");
    fs.mkdirSync(seed);
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(seed, "profile"), "picade\n");
    fs.writeFileSync(path.join(src, "provision.sh"), `echo "[provision 10:00:00] profile picade"\necho "[provision 10:00:01] == 1/2 Checking the clock"\necho "[provision 10:00:02] == 2/2 Installing speech: Moonshine"\nsleep ${slow}\nexit ${exitCode}\n`);
    execFileSync("tar", ["-czf", path.join(seed, "provision.tar.gz"), "-C", src, "."]);
    const screen = path.join(root, "tty1");
    fs.writeFileSync(screen, "");
    const uptime = path.join(root, "uptime");
    fs.writeFileSync(uptime, "185.42 600.10\n"); // 3 minutes since power-on
    const r = spawnSync("/bin/bash", [path.join(REPO, "cabinet/provision/files/firstboot.sh")], { encoding: "utf8", env: { ...process.env, ARCADE_SEED: seed, ARCADE_WORK: path.join(root, "work"), ARCADE_SCREEN: screen, ARCADE_UPTIME: uptime, ARCADE_TICK_S: tick, ARCADE_REBOOT_FLAG: path.join(root, reboot ? "seed/profile" : "no-flag"), ARCADE_RESTART: "echo restart-scheduled" } });
    const out = { status: r.status, log: r.stdout, screen: fs.readFileSync(screen, "utf8"), ok: fs.existsSync(path.join(seed, "provision.ok")) };
    fs.rmSync(root, { recursive: true, force: true });
    return out;
  };
  const good = run(0);
  const ticked = run(0, { tick: "0.2", slow: 1 });
  assert.ok((ticked.screen.match(/Switched on 3 minutes ago/g) ?? []).length > (good.screen.match(/Switched on 3 minutes ago/g) ?? []).length, "the ticker redraws between steps");
  assert.match(ticked.log, /=== firstboot exit 0 /);
  // With the restart wanted, it's scheduled, and first boot still finishes and logs exit 0 after it.
  const restart = run(0, { reboot: true });
  assert.match(restart.log, /restarting once[\s\S]*restart-scheduled[\s\S]*=== firstboot exit 0 /);
  assert.doesNotMatch(fs.readFileSync(path.join(REPO, "cabinet/provision/files/firstboot.sh"), "utf8"), /^\s*systemctl reboot --no-block\s*$/m, "never a restart that stops first boot mid-script");
  assert.equal(good.status, 0, good.log);
  assert.match(good.log, /== 2\/2 Installing speech/, "the log keeps every line");
  assert.match(good.screen, /Step 1\/2\s+Checking the clock/);
  assert.match(good.screen, /Step 2\/2\s+Installing speech: Moonshine/);
  assert.match(good.screen, /Done\./);
  assert.match(good.screen, /Switched on 3 minutes ago\.\n/, "minutes since power-on, on its own line: the Pi has no clock until NTP (D257)");
  assert.doesNotMatch(good.screen, /Started at|\d{1,2}:\d{2}/, "no clock time on the screen");
  assert.match(good.log, /=== firstboot exit 0 /, "first boot logs its own exit status (the journal doesn't outlive the restart)");
  assert.doesNotMatch(good.log, /Terminated/, "the ticker stops cleanly");
  assert.ok(good.ok);
  // Nothing wraps on the 64-column console: the longest stage title, the failure, and the longest minutes line.
  const COLS = 64;
  const titles = [...prov.matchAll(/^stage "([^"]+)"$/gm)].map((m) => m[1]);
  const screenLines = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "\n").split("\n");
  for (const t of titles) assert.ok(`  ${t}`.length <= COLS, `stage title too wide for the console: ${t}`);
  const wide = (o) => screenLines(o.screen).filter((l) => l.length > COLS);
  assert.deepEqual(wide(good), []);
  const bad = run(3);
  assert.deepEqual(wide(bad), []);
  assert.notEqual(bad.status, 0, "a failed provision fails first boot, so it runs again at the next boot");
  assert.match(bad.screen, /Setup stopped\./);
  assert.match(bad.log, /=== firstboot exit [1-9]/);
  assert.ok(!bad.ok);
});

test("speech's lock reads as exact wheels, each with its hash (D257)", () => {
  const wheels = lockedWheels(fs.readFileSync(path.join(REPO, "cabinet/service/speech/requirements.lock"), "utf8"));
  assert.ok(wheels.length >= 5);
  assert.ok(wheels.some((w) => w.name === "moonshine-voice"));
  for (const w of wheels) assert.match(w.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => lockedWheels("numpy>=2"), /can't read/);
});

test("the Picade's driver keyboard stays off unless its setting says on (D287)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drv-"));
  const setting = path.join(dir, "driver-keyboard");
  const modules = path.join(dir, "arcade-driver.conf");
  const stubs = `install() { echo "install $*"; }; systemctl() { echo "systemctl $*"; }; modprobe() { echo "modprobe $*"; }; DRIVER_SETTING=${JSON.stringify(setting)}; DRIVER_MODULES=${JSON.stringify(modules)}; step_driver_keyboard`;
  let out = profileBash(stubs);
  assert.match(out, /systemctl disable --now arcade-keyd/);
  assert.doesNotMatch(out, /systemctl enable|modprobe uinput/);
  assert.match(out, /driver keyboard: off/);
  assert.ok(!fs.existsSync(modules));
  fs.writeFileSync(setting, "off\n");
  assert.match(profileBash(stubs), /driver keyboard: off/);
  fs.writeFileSync(setting, "on\n");
  out = profileBash(stubs);
  assert.match(out, /modprobe uinput/);
  assert.match(out, /systemctl enable arcade-keyd/);
  assert.match(out, /driver keyboard: on/);
  assert.equal(fs.readFileSync(modules, "utf8").trim(), "uinput");
  // It is part of every provisioning run on the Picade.
  assert.match(fs.readFileSync(PROFILE, "utf8"), /hw_late\(\) \{[^}]*step_driver_keyboard/);
});

test("one place for the Picade's SSH key: picade-ssh.sh, read by everything that reaches the Picade (D259)", async () => {
  const { PICADE_HOST, PICADE_KEY_NAME, PICADE_DATA_ROOT, PICADE_DIR_UNDER_DATA, picadeDir } = await import("../picade.mjs");
  assert.equal(PICADE_HOST, "arcade.local");
  assert.equal(picadeDir({}, "/home/x/game-studio-data"), path.join("/home/x/game-studio-data", PICADE_DIR_UNDER_DATA));
  assert.equal(picadeDir({ GSA_CABINET_DIR: "/elsewhere" }), "/elsewhere", "GSA_CABINET_DIR moves it");
  // The shell side gives the same answer.
  const sh = execFileSync("/bin/bash", ["-c", `. ${JSON.stringify(path.join(REPO, "scripts/cabinet-card/picade-ssh.sh"))}; echo "$PICADE_DIR $PICADE_KEY_NAME $PICADE_HOST"`], { encoding: "utf8", env: { ...process.env, HOME: "/home/x", GSA_CABINET_DIR: "" } }).trim();
  assert.equal(sh, `${path.join("/home/x", PICADE_DATA_ROOT, PICADE_DIR_UNDER_DATA)} ${PICADE_KEY_NAME} ${PICADE_HOST}`);
  // No code spells the folder or the key's name anywhere else, so a second path can't creep in.
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: REPO, encoding: "utf8" }).split("\n").filter((f) => /\.(mjs|js|sh)$|(^|\/)drive$/.test(f) && !f.includes("node_modules") && fs.existsSync(path.join(REPO, f)));
  const allowed = new Set(["scripts/cabinet-card/picade-ssh.sh"]);
  const spelled = [PICADE_DIR_UNDER_DATA, PICADE_DIR_UNDER_DATA.split("/").map((x) => `"${x}"`).join(", "), `${PICADE_DATA_ROOT}/picade`, PICADE_KEY_NAME];
  const hits = [];
  for (const f of files) {
    if (allowed.has(f) || f.includes("/test/")) continue;
    const text = fs.readFileSync(path.join(REPO, f), "utf8");
    for (const word of spelled) if (text.includes(word)) hits.push(`${f}: ${word}`);
  }
  assert.deepEqual(hits, [], "use scripts/cabinet-card/picade-ssh.sh (shell) or picade.mjs (Node)");
  for (const f of ["scripts/cabinet-card/connect-picade.sh", "scripts/cabinet-card/driver-keyboard.sh"]) assert.match(fs.readFileSync(path.join(REPO, f), "utf8"), /picade-ssh\.sh/, f);
  for (const f of ["scripts/cabinet-card/flash.mjs", "scripts/twin.mjs", "manager/cabinet.mjs"]) assert.match(fs.readFileSync(path.join(REPO, f), "utf8"), /cabinet-card\/picade\.mjs|\.\/picade\.mjs/, f);
});

// ---- The card carries the keys (D320-D323) ----

const FAKE = { anthropic_api_key: "sk-ant-api03-FAKEPICADEKEY000", agent_id: "agent_FAKE", agent_version: 4, environment_id: "env_FAKE", groq_api_key: "gsk_FAKEGROQKEY000" };

test("first boot installs the card's cabinet config, then wipes it from the card, without printing it (D322)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-config-"));
  const payload = path.join(dir, "seed");
  const etc = path.join(dir, "etc");
  fs.mkdirSync(payload);
  fs.mkdirSync(etc);
  const got = path.join(dir, "installed.json");
  const stub = path.join(dir, "install");
  fs.writeFileSync(stub, `#!/bin/sh\n[ "$ARCADE_NO_RESTART" = 1 ] || { echo "would restart" >&2; exit 9; }\ncat > ${JSON.stringify(got)}\n[ -f "$FAIL" ] && { echo 'The config on stdin has no agent_id.' >&2; exit 1; }\nexit 0\n`, { mode: 0o755 });
  const file = path.join(payload, "cabinet-config.json");
  const script = (body) => `log() { echo "[provision] $*"; }; PAYLOAD=${JSON.stringify(payload)}; ARCADE_HOME=/nowhere; . ${JSON.stringify(path.join(REPO, "cabinet/provision/cabinet-config.sh"))}; ${body}`;
  const step = (env = {}) => {
    fs.writeFileSync(file, JSON.stringify(FAKE));
    return execFileSync("/bin/bash", ["-c", script("step_cabinet_config")], { encoding: "utf8", env: { ...process.env, CONFIG_INSTALL: stub, ARCADE_ETC: etc, ...env } });
  };
  let out = step();
  assert.deepEqual(JSON.parse(fs.readFileSync(got, "utf8")), FAKE, "service-config install got the card's config on stdin, Groq key and all");
  assert.ok(!fs.existsSync(file), "wiped from the card");
  assert.match(out, /connected: the card's key, agent and Groq key are in service.json/);
  assert.match(out, /wiped the cabinet config from the card/);
  assert.ok(!out.includes("FAKE"), "never printed");
  // A failed install still wipes it, and says why without quoting it.
  fs.rmSync(got);
  fs.writeFileSync(path.join(dir, "fail"), "");
  out = step({ FAIL: path.join(dir, "fail") });
  assert.match(out, /didn't install \(The config on stdin has no agent_id\.\): the cabinet starts offline/);
  assert.ok(!fs.existsSync(file));
  assert.ok(!out.includes("FAKE"));
  // A cabinet that already has a config keeps it; the card's copy is still wiped.
  fs.rmSync(path.join(dir, "fail"));
  fs.rmSync(got, { force: true });
  fs.writeFileSync(path.join(etc, "service.json"), "{}");
  out = step();
  assert.ok(!fs.existsSync(got), "not installed over an existing config");
  assert.match(out, /already has one: keeping it/);
  assert.ok(!fs.existsSync(file));
  // No file on the card: nothing happens.
  assert.equal(execFileSync("/bin/bash", ["-c", script("step_cabinet_config")], { encoding: "utf8" }), "");
  assert.match(fs.readFileSync(path.join(REPO, "cabinet/provision/provision.sh"), "utf8"), /step_carts\nstep_library\nstep_cabinet_config\n/, "after the carts (service-config.mjs takes arcade's uid from them), before the services start");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("first boot installs the card's config with the real service-config.mjs, before /etc/arcade exists (D322)", () => {
  // The 2026-11-13 rehearsal: /etc/arcade isn't made until step_services, so the install had nowhere to write.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-config-real-"));
  const payload = path.join(dir, "seed");
  const etc = path.join(dir, "etc-not-yet");
  const data = path.join(dir, "data");
  fs.mkdirSync(payload);
  fs.mkdirSync(path.join(data, "carts"), { recursive: true });
  const file = path.join(payload, "cabinet-config.json");
  fs.writeFileSync(file, JSON.stringify(FAKE));
  const install = `${process.execPath} ${path.join(REPO, "cabinet/vm/guest/service-config.mjs")} install`;
  const out = execFileSync("/bin/bash", ["-c", `log() { echo "[provision] $*"; }; PAYLOAD=${JSON.stringify(payload)}; . ${JSON.stringify(path.join(REPO, "cabinet/provision/cabinet-config.sh"))}; step_cabinet_config`], { encoding: "utf8", env: { ...process.env, CONFIG_INSTALL: install, ARCADE_ETC: etc, ARCADE_DATA: data } });
  assert.match(out, /connected: the card's key, agent and Groq key are in service.json/, out);
  const config = JSON.parse(fs.readFileSync(path.join(etc, "service.json"), "utf8"));
  assert.equal(config.anthropic_api_key, FAKE.anthropic_api_key);
  assert.equal(config.groq_api_key, FAKE.groq_api_key, "the Groq key rides along");
  assert.equal(config.agent_id, FAKE.agent_id);
  assert.equal(fs.statSync(path.join(etc, "service.json")).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(etc, "service.env"), "utf8"), `ARCADE_SERVICE_ARGS=--config ${path.join(etc, "service.json")}\n`, "the service starts live");
  assert.ok(!fs.existsSync(file), "wiped from the card");
  assert.ok(!out.includes("FAKE"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the card's config: a workspace key, the agent ids, and the Groq key; errors never quote it (D320, D321)", async () => {
  const { parseIdentity, cabinetConfigText, configFromFile, SecretsError } = await import("../secrets.mjs");
  const text = cabinetConfigText({ identity: FAKE, groq: FAKE.groq_api_key });
  assert.deepEqual(JSON.parse(text), FAKE);
  assert.equal(JSON.parse(cabinetConfigText({ identity: FAKE, groq: null })).groq_api_key, undefined, "--no-groq: Moonshine only");
  for (const bad of ['{"anthropic_api_key":"sk-ant-admin01-FAKE","agent_id":"a","environment_id":"e"}', '{"anthropic_api_key":"nope-FAKE","agent_id":"a","environment_id":"e"}', '{"anthropic_api_key":"sk-ant-api03-FAKE","environment_id":"e"}', "not json FAKE"]) {
    assert.throws(() => parseIdentity(bad), (e) => e instanceof SecretsError && !String(e.message).includes("FAKE"));
  }
  assert.throws(() => cabinetConfigText({ identity: FAKE, groq: "not-a-groq-key" }), SecretsError);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-cfg-"));
  fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(FAKE));
  assert.deepEqual(JSON.parse(configFromFile(path.join(dir, "c.json"))), FAKE);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Groq key comes from the virtual cabinet over its own SSH, with the Picade's settings stripped (D321)", async () => {
  const { groqFromVirtual, SecretsError } = await import("../secrets.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-groq-"));
  const drive = path.join(dir, "drive");
  const seen = path.join(dir, "seen");
  fs.writeFileSync(drive, `#!/bin/sh\necho "$* host=\${ARCADE_HOST:-default} dir=\${ARCADE_SSH_DIR:-default}" > ${JSON.stringify(seen)}\ncase "$STUB" in ok) printf 'gsk_FAKEGROQKEY000' ;; none) echo 'This cabinet has no Groq key.' >&2; exit 4 ;; old) exit 2 ;; down) exit 255 ;; junk) printf 'hello' ;; esac\n`, { mode: 0o755 });
  const env = (STUB) => ({ ...process.env, STUB, ARCADE_HOST: "arcade.local", ARCADE_SSH_DIR: "/picade/ssh" });
  assert.equal(await groqFromVirtual({ drive, env: env("ok") }), "gsk_FAKEGROQKEY000");
  assert.equal(fs.readFileSync(seen, "utf8").trim(), "ssh sudo node /opt/arcade/current/cabinet/vm/guest/service-config.mjs groq-key host=default dir=default", "the virtual cabinet's own defaults, not the Picade's");
  for (const [stubbed, re] of [["none", /no Groq key to copy/], ["old", /older than this/], ["down", /can't reach the virtual cabinet/], ["junk", /doesn't look like a Groq key/]]) {
    await assert.rejects(groqFromVirtual({ drive, env: env(stubbed) }), (e) => e instanceof SecretsError && re.test(e.message));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the identity comes back from connect-cabinet.sh --prepare through a FIFO; a stop doesn't hang (D320)", async () => {
  const { identityFromConnect, SecretsError } = await import("../secrets.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-id-"));
  const script = path.join(dir, "connect");
  const json = JSON.stringify({ anthropic_api_key: FAKE.anthropic_api_key, agent_id: "agent_FAKE", agent_version: 4, environment_id: "env_FAKE" });
  fs.writeFileSync(script, `#!/bin/sh\n[ "$1" = --prepare ] && [ -p "$2" ] || exit 7\n[ "$STUB" = stop ] && { echo "Stopped: nothing applied" >&2; exit 1; }\nprintf '%s' '${json}' > "$2"\n`, { mode: 0o755 });
  const id = await identityFromConnect({ script, env: { ...process.env, STUB: "ok" } });
  assert.equal(id.agent_id, "agent_FAKE");
  assert.equal(id.anthropic_api_key, FAKE.anthropic_api_key);
  const started = Date.now();
  await assert.rejects(identityFromConnect({ script, env: { ...process.env, STUB: "stop" } }), SecretsError);
  assert.ok(Date.now() - started < 5000, "a script that stops before writing doesn't leave flash waiting");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flash.mjs: with no stored identity it says to run picade-key.sh first, and writes nothing (D329)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-flash-"));
  // Never the mini's own identity folder: a test mustn't read Geoff's key.
  const r = spawnSync(process.execPath, [FLASH, "--image-file", path.join(dir, "x.img"), "--allow-dirty"], { encoding: "utf8", input: "Net\npassword123\n", env: { ...process.env, GSA_PICADE_IDENTITY_DIR: path.join(dir, "no-identity") } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no Picade identity at .* yet: run scripts\/cabinet-card\/picade-key\.sh first/);
  assert.ok(!fs.existsSync(path.join(dir, "x.img")), "stopped before anything was written");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("first boot unpacks the twin's data into an empty data folder, before the starters, never over data (D324)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-twin-"));
  const payload = path.join(dir, "seed");
  const data = path.join(dir, "data");
  const src = path.join(dir, "src");
  fs.mkdirSync(payload);
  fs.mkdirSync(path.join(src, "carts/rock-rain"), { recursive: true });
  fs.mkdirSync(path.join(src, "logs"));
  fs.writeFileSync(path.join(src, "carts/rock-rain/cart.json"), '{"id":"rock-rain"}');
  fs.writeFileSync(path.join(src, "makers.json"), '[{"id":"tester"}]');
  fs.writeFileSync(path.join(src, "logs/coin_ledger.jsonl"), '{"kind":"refill"}\n');
  fs.writeFileSync(path.join(src, "twin-seed.json"), "{}");
  execFileSync("tar", ["-czf", path.join(payload, "twin-data.tar.gz"), "-C", src, "."]);
  const step = () => execFileSync("/bin/bash", ["-c", `log() { echo "[provision] $*"; }; PAYLOAD=${JSON.stringify(payload)}; DATA=${JSON.stringify(data)}; . ${JSON.stringify(path.join(REPO, "cabinet/provision/twin-data.sh"))}; step_twin_data`], { encoding: "utf8", env: { ...process.env, DATA_OWNER: "true" } });
  let out = step();
  assert.match(out, /the twin's data is here \(D324\): 1 games/);
  assert.equal(fs.readFileSync(path.join(data, "carts/rock-rain/cart.json"), "utf8"), '{"id":"rock-rain"}');
  assert.equal(fs.readFileSync(path.join(data, "logs/coin_ledger.jsonl"), "utf8"), '{"kind":"refill"}\n');
  assert.ok(fs.existsSync(path.join(payload, "twin-data.tar.gz")), "the card keeps its copy (D5)");
  // Never over a cabinet's own data.
  fs.writeFileSync(path.join(data, "makers.json"), '[{"id":"owen"}]');
  out = step();
  assert.match(out, /already has data: keeping its own/);
  assert.equal(fs.readFileSync(path.join(data, "makers.json"), "utf8"), '[{"id":"owen"}]');
  const prov = fs.readFileSync(path.join(REPO, "cabinet/provision/provision.sh"), "utf8");
  assert.match(prov, /step_twin_data\nstep_carts\nstep_library\nstep_cabinet_config\n/, "before the starters, so a twin's own copies of them stay");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Wi-Fi can come from a 0600 file on the mini; it's refused if others can read it, and never quoted (D327)", async () => {
  const { wifiFromFile } = await import("../lib.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-wifi-"));
  const file = path.join(dir, "wifi.json");
  const io = { uid: process.getuid(), stat: (f) => fs.statSync(f), read: (f) => fs.readFileSync(f, "utf8") };
  fs.writeFileSync(file, JSON.stringify({ ssid: "IEEE", password: "password" }), { mode: 0o600 });
  assert.deepEqual(wifiFromFile(file, io), { ssid: "IEEE", psk: "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e" }, "the password becomes the WPA key, as typed would");
  fs.writeFileSync(file, JSON.stringify({ ssid: "IEEE", psk: "F42C6FC52DF0EBEF9EBB4B90B38A5F902E83FE1B135A70E23AED762E9710A12E" }));
  assert.equal(wifiFromFile(file, io).psk, "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e", "or the key itself");
  fs.chmodSync(file, 0o644);
  assert.throws(() => wifiFromFile(file, io), /can be read by others: chmod 600/);
  fs.chmodSync(file, 0o600);
  assert.throws(() => wifiFromFile(file, { ...io, uid: io.uid + 1 }), /belongs to someone else/);
  fs.writeFileSync(file, '{"ssid": "Net", "password": "SECRETPW12345" ');
  assert.throws(() => wifiFromFile(file, io), (e) => /isn't JSON/.test(e.message) && !e.message.includes("SECRETPW"));
  fs.writeFileSync(file, JSON.stringify({ password: "SECRETPW12345" }));
  assert.throws(() => wifiFromFile(file, io), /no "ssid"/);
  fs.writeFileSync(file, JSON.stringify({ ssid: "Net" }));
  assert.throws(() => wifiFromFile(file, io), /no "password"/);
  fs.writeFileSync(file, JSON.stringify({ ssid: "Net", password: "short" }));
  assert.throws(() => wifiFromFile(file, io), /8 to 63/);
  assert.throws(() => wifiFromFile(dir, io), /isn't a plain file/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- picade-key.sh (D329) ----

test("picade-key stores the identity in a private 0600 file, and reads back only such a file (D329)", async () => {
  const { writeIdentity, readIdentity } = await import("../picade-key.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picade-key-"));
  const file = path.join(dir, "cabinets/arcade/identity.json");
  const id = { anthropic_api_key: FAKE.anthropic_api_key, agent_id: "agent_FAKE", agent_version: 4, environment_id: "env_FAKE" };
  writeIdentity(file, id);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(readIdentity(file), id);
  assert.ok(!fs.existsSync(`${file}.new`), "written in one step");
  writeIdentity(file, { ...id, agent_version: 5 });
  assert.equal(readIdentity(file).agent_version, 5, "a new key replaces the old one");
  fs.chmodSync(file, 0o644);
  assert.throws(() => readIdentity(file), /can be read by others: chmod 600/);
  assert.throws(() => readIdentity(path.join(dir, "missing.json")), /run scripts\/cabinet-card\/picade-key\.sh first/);
  assert.throws(() => writeIdentity(file, { ...id, anthropic_api_key: "sk-ant-admin01-FAKE" }), (e) => !String(e.message).includes("FAKE"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("picade-key's live check: the agent at its version, one capped session with no message, archived (D329)", async () => {
  const { liveCheck, safeMessage } = await import("../picade-key.mjs");
  /** @type {any[]} */
  const calls = [];
  const client = {
    beta: {
      agents: { retrieve: async (id, p) => (calls.push(["retrieve", id, p]), { id, version: 4 }) },
      sessions: {
        create: async (body) => (calls.push(["create", body]), { id: "sesn_FAKE" }),
        archive: async (sid) => (calls.push(["archive", sid]), { id: sid }),
      },
    },
  };
  const r = await liveCheck(client, { agent_id: "agent_FAKE", agent_version: 4, environment_id: "env_FAKE" });
  assert.equal(r.agentVersion, 4);
  assert.deepEqual(calls[0], ["retrieve", "agent_FAKE", { version: 4 }]);
  const body = calls[1][1];
  assert.deepEqual(body.agent, { type: "agent", id: "agent_FAKE", version: 4 });
  assert.equal(body.environment_id, "env_FAKE");
  assert.deepEqual(body.budget, { type: "limit", max_list_cost: { amount: "5", currency: "USD" } }, "capped at 5 cents");
  assert.equal(body.initial_events, undefined, "no message: the model never runs");
  assert.deepEqual(calls[2], ["archive", "sesn_FAKE"], "archived at once (kept, not deleted)");
  assert.equal(safeMessage(new Error("401 bad key sk-ant-api03-FAKEPICADEKEY000 and gsk_FAKEGROQKEY000\nmore")), "401 bad key [key] and [key]");
});

test("picade-key.sh refuses arguments and a missing terminal, and --check says to set up first (D329)", () => {
  const SCRIPT = path.join(REPO, "scripts/cabinet-card/picade-key.sh");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picade-key-sh-"));
  const env = { ...process.env, GSA_NODE: process.execPath, GSA_PICADE_IDENTITY_DIR: path.join(dir, "none") };
  const arg = spawnSync(SCRIPT, ["sk-ant-api03-FAKEPICADEKEY000"], { encoding: "utf8", env });
  assert.equal(arg.status, 1);
  assert.match(arg.stderr, /the only option is --check\. The key is never an argument/);
  assert.ok(!arg.stderr.includes("FAKEPICADE") && !arg.stdout.includes("FAKEPICADE"), "never repeated");
  const noTty = spawnSync(SCRIPT, [], { encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] });
  assert.match(noTty.stderr, /run this in a Terminal window on the mini/);
  const check = spawnSync(SCRIPT, ["--check"], { encoding: "utf8", env });
  assert.equal(check.status, 1);
  assert.match(check.stderr, /no Picade identity at .* yet: run scripts\/cabinet-card\/picade-key\.sh first/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- The day-one card (D356-D359) ----

test("day-one: a full pot, Tester off \"Who's making?\", and marks for every shelf line not chosen, in D360's format", async () => {
  const { applyDayOne, parseDayOne, MARKS, VIA } = await import("../day-one.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day-one-"));
  const cart = (id, extra = {}) => {
    fs.mkdirSync(path.join(dir, "carts", id), { recursive: true });
    fs.writeFileSync(path.join(dir, "carts", id, "cart.json"), JSON.stringify({ id, title: id, ...extra }));
  };
  cart("rock-rain");
  cart("candy-cat-drop");
  cart("candy-cat-drop-v2", { branch: "candy-cat-drop" });
  cart("fruit-cat-drop", { parent: "candy-cat-drop@1" });
  cart("apple-catch");
  fs.mkdirSync(path.join(dir, "logs"));
  fs.writeFileSync(path.join(dir, "logs/coin_ledger.jsonl"), '{"kind":"charge"}\n');
  const makers = [{ id: "tester", name: "Tester" }, { id: "tester2", name: "Tester2" }, { id: "geoff", name: "Geoff", grown_up: true }];
  fs.writeFileSync(path.join(dir, "makers.json"), JSON.stringify(makers));
  const before = fs.readFileSync(path.join(dir, "makers.json"), "utf8");
  const spec = parseDayOne(JSON.stringify({ pot: "full", hide_makers: ["tester", "tester2"], shelf: ["teti", "teti-geoff", "rock-rain", "candy-cat-drop-v2"] }));
  const now = new Date("2026-11-14T09:00:00Z");
  const d = applyDayOne(dir, spec, { guestIds: ["teti", "teti-geoff"], now });
  assert.equal(d.ledgerLeftOff, true);
  assert.ok(!fs.existsSync(path.join(dir, "logs/coin_ledger.jsonl")), "the copy's ledger is left off: the pot starts full");
  assert.equal(fs.readFileSync(path.join(dir, "makers.json"), "utf8"), before, "makers.json is never touched (D360)");
  assert.deepEqual(d.shelf, ["candy-cat-drop", "rock-rain", "teti", "teti-geoff"], "naming a version keeps its whole line");
  assert.deepEqual(d.offShelf, ["apple-catch", "fruit-cat-drop"], "a kid's own version is its own line");
  const text = fs.readFileSync(path.join(dir, MARKS), "utf8");
  assert.ok(text.endsWith("\n"));
  const lines = text.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((m) => `${m.kind}:${m.target}`), ["maker:tester", "maker:tester2", "game:apple-catch", "game:fruit-cat-drop"]);
  for (const m of lines) {
    assert.equal(m.type, "shelf_mark");
    assert.equal(m.action, "remove");
    assert.equal(m.by, "geoff");
    assert.equal(m.via, VIA);
    assert.equal(m.at, "2026-11-14T09:00:00.000Z");
    assert.match(m.id, /^sm_[0-9a-z]+$/);
    assert.equal(typeof m.reason, "string");
  }
  assert.equal(new Set(lines.map((m) => m.id)).size, lines.length, "every mark has its own id");
  // Unknown ids are reported (the flash stops on them), not guessed.
  const d2 = applyDayOne(dir, parseDayOne(JSON.stringify({ hide_makers: ["nobody"], shelf: ["no-such-game"] })), { guestIds: [] });
  assert.deepEqual(d2.unknownMakers, ["nobody"]);
  assert.deepEqual(d2.unknownGames, ["no-such-game"]);
  for (const bad of ["{", '{"pot":"empty"}', '{"shelf":"teti"}', '{"hide":["x"]}', '{"shelf":["Bad Id"]}']) assert.throws(() => parseDayOne(bad));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--day-one is never applied to a restore from the backup (D354, D356)", () => {
  const src = fs.readFileSync(FLASH, "utf8");
  assert.match(src, /if \(flag\("--from-backup"\)\) stop\("--day-one is a clean start; --from-backup brings a card back as it was/);
});

test("first boot removes speech's install files from the card after a full success, and keeps them for a retry (D359)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "card-speech-"));
  const run = (exitCode, installed) => {
    const seed = path.join(root, `seed-${exitCode}-${installed}`);
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(seed, "speech/models"), { recursive: true });
    fs.writeFileSync(path.join(seed, "speech/models/encoder.ort"), "x".repeat(1000));
    fs.writeFileSync(path.join(seed, "profile"), "picade\n");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "provision.sh"), `echo "[provision 10:00:00] == 1/1 Finishing"\nexit ${exitCode}\n`);
    execFileSync("tar", ["-czf", path.join(seed, "provision.tar.gz"), "-C", src, "."]);
    const speechJson = path.join(root, installed ? "speech.json" : "not-there.json");
    if (installed) fs.writeFileSync(speechJson, "{}");
    const r = spawnSync("/bin/bash", [path.join(REPO, "cabinet/provision/files/firstboot.sh")], { encoding: "utf8", env: { ...process.env, ARCADE_SEED: seed, ARCADE_WORK: path.join(root, `work-${exitCode}`), ARCADE_SCREEN: path.join(root, "tty"), ARCADE_SPEECH_JSON: speechJson, ARCADE_TICK_S: "30" } });
    return { log: r.stdout, kept: fs.existsSync(path.join(seed, "speech")) };
  };
  const ok = run(0, true);
  assert.ok(!ok.kept, ok.log);
  assert.match(ok.log, /removed speech's install files from the card, \d+ MB freed/);
  assert.ok(run(3, true).kept, "a failed first boot keeps them for the retry");
  assert.ok(run(0, false).kept, "not installed: kept");
  fs.rmSync(root, { recursive: true, force: true });
});

test("docs/day-one.json is a valid day-one file: full pot, Tester hidden, the agreed shelf (D356)", async () => {
  const { parseDayOne } = await import("../day-one.mjs");
  const spec = parseDayOne(fs.readFileSync(path.join(REPO, "docs/day-one.json"), "utf8"));
  assert.equal(spec.pot, "full");
  assert.deepEqual(spec.hide_makers, ["tester", "tester2"]);
  for (const id of ["teti", "teti-geoff", "apple-catch", "comet-dodge", "wall-ball"]) assert.ok(spec.shelf.includes(id), id);
});

test("a card with no twin data starts the cart library the service's way, starters committed; a seeded one is untouched (D390)", async () => {
  const { ensureLibrary } = await import("../../../studio-kit/cli/src/library.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-library-"));
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  const step = (data) =>
    execFileSync("/bin/bash", ["-c", `log() { echo "[provision] $*"; }; DATA=${JSON.stringify(data)}; . ${JSON.stringify(path.join(REPO, "cabinet/provision/library.sh"))}; STARTER_IDS=" apple-catch comet-dodge wall-ball"; step_library`], { encoding: "utf8", env: { ...process.env, GIT_AS: " ", DATA_OWNER_FILE: "true" } });
  // New: three starters copied in, no library yet.
  const fresh = path.join(dir, "fresh");
  for (const [name, id] of [["catch", "apple-catch"], ["dodge", "comet-dodge"], ["paddle", "wall-ball"]]) fs.cpSync(path.join(REPO, "studio-kit/context-pack/templates", name), path.join(fresh, "carts", id), { recursive: true });
  const out = step(fresh);
  assert.match(out, /started the cart library: 3 starters committed/);
  const lib = path.join(fresh, "carts");
  assert.equal(git(lib, "status", "--porcelain"), "", "nothing left untracked");
  assert.deepEqual(git(lib, "log", "--format=%s", "--reverse").split("\n"), ["Start the dev cart library", "starter apple-catch v1 (D161)", "starter comet-dodge v1 (D161)", "starter wall-ball v1 (D161)"]);
  assert.equal(git(lib, "log", "-1", "--format=%an <%ae>"), "Studio <studio@game-studio-arcade.invalid>", "the service's author");
  // The service's own ensureLibrary finds it ready and changes nothing.
  const head = git(lib, "rev-parse", "HEAD");
  ensureLibrary(lib);
  assert.equal(git(lib, "rev-parse", "HEAD"), head);
  assert.equal(fs.readFileSync(path.join(lib, "README.md"), "utf8"), "# Dev cart library\n\nOne folder per cart. Never delete; every version is a commit.\n", "the same README as ensureLibrary writes");
  // Seeded (the twin's library, starters untracked as on the virtual cabinet): left exactly as it is.
  const seeded = path.join(dir, "seeded");
  fs.cpSync(fresh, seeded, { recursive: true });
  fs.cpSync(path.join(REPO, "studio-kit/context-pack/templates/catch"), path.join(seeded, "carts", "loose-starter"), { recursive: true });
  const before = git(path.join(seeded, "carts"), "rev-parse", "HEAD");
  assert.match(step(seeded), /already there: leaving it as it is/);
  assert.equal(git(path.join(seeded, "carts"), "rev-parse", "HEAD"), before);
  assert.match(git(path.join(seeded, "carts"), "status", "--porcelain"), /\?\? loose-starter\//, "an untracked folder stays untracked");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commit-starters.sh commits the twin's untracked starters the first-boot way, once, and only adds (D391)", () => {
  const SCRIPT = path.join(REPO, "scripts/virtual-cabinet/commit-starters.sh");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starters-"));
  const lib = path.join(dir, "carts");
  const git = (...a) => execFileSync("git", a, { cwd: lib, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Studio", GIT_AUTHOR_EMAIL: "studio@game-studio-arcade.invalid", GIT_COMMITTER_NAME: "Studio", GIT_COMMITTER_EMAIL: "studio@game-studio-arcade.invalid" } }).trim();
  // Like the twin today: a library with made games, the three starters untracked.
  fs.mkdirSync(lib, { recursive: true });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(lib, "README.md"), "# Dev cart library\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "Start the dev cart library");
  fs.cpSync(path.join(REPO, "studio-kit/context-pack/templates/dodge"), path.join(lib, "log-hopper"), { recursive: true });
  git("add", "log-hopper");
  git("commit", "-q", "-m", "make log-hopper v1 (sesn_X)");
  for (const [name, id] of [["catch", "apple-catch"], ["dodge", "comet-dodge"], ["paddle", "wall-ball"]]) fs.cpSync(path.join(REPO, "studio-kit/context-pack/templates", name), path.join(lib, id), { recursive: true });
  const run = (...args) => spawnSync(SCRIPT, args, { encoding: "utf8", env: { ...process.env, COMMIT_STARTERS_LOCAL: dir } });
  const before = git("rev-parse", "HEAD");
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /would commit 3 starters/);
  assert.equal(git("rev-parse", "HEAD"), before, "a dry run changes nothing");
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /committed 3 starters; untracked now: 0/);
  assert.deepEqual(git("log", "--format=%s", "-3", "--reverse").split("\n"), ["starter apple-catch v1 (D161)", "starter comet-dodge v1 (D161)", "starter wall-ball v1 (D161)"]);
  assert.equal(git("rev-list", "--count", "HEAD"), "5", "only commits added; the made game's history is as it was");
  assert.equal(git("log", "-1", "--format=%an <%ae>"), "Studio <studio@game-studio-arcade.invalid>");
  const head = git("rev-parse", "HEAD");
  const again = run();
  assert.match(again.stdout, /already in the library[\s\S]*committed 0 starters/);
  assert.equal(git("rev-parse", "HEAD"), head, "running it again does nothing");
  // Never while a make runs: the service commits to the same library.
  fs.writeFileSync(path.join(dir, "studio-run.json"), "{}");
  const busy = run();
  assert.equal(busy.status, 4);
  assert.match(busy.stdout, /a make is running/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--erase-confirmed must name this exact card, or the flash stops before writing (D394)", () => {
  const src = fs.readFileSync(FLASH, "utf8");
  assert.match(src, /const given = opt\("--erase-confirmed"\);\n\s+if \(given !== undefined\) \{\n\s+if \(given !== phrase\) stop\(/);
  assert.ok(src.indexOf('opt("--erase-confirmed")') < src.indexOf("confirmed = info;"), "checked before the card is marked confirmed");
});

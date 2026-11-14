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
  assert.match(fs.readFileSync(path.join(REPO, "cabinet/provision/provision.sh"), "utf8"), /step_carts\nstep_cabinet_config\n/, "after the carts (service-config.mjs takes arcade's uid from them), before the services start");
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

test("flash.mjs: with no terminal there's no identity unless told, and nothing is written (D323)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-flash-"));
  const r = spawnSync(process.execPath, [FLASH, "--image-file", path.join(dir, "x.img"), "--allow-dirty"], { encoding: "utf8", input: "Net\npassword123\n" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no one to paste the Picade's key: pass --no-identity, or --cabinet-config-from FILE/);
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
  assert.match(prov, /step_twin_data\nstep_carts\nstep_cabinet_config\n/, "before the starters, so a twin's own copies of them stay");
  fs.rmSync(dir, { recursive: true, force: true });
});

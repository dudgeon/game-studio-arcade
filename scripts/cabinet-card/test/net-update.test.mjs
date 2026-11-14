// The Picade's network update with its ways back (D330-D338): the parts that run with no cabinet.
// The whole thing on a QEMU copy of the card, by hand: scripts/cabinet-card/test/update-rehearsal.sh.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProvisionTar } from "../../virtual-cabinet/lib.mjs";
import { agentChanged, updateTarget } from "../../virtual-cabinet/update-target.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROV = path.join(REPO, "cabinet/provision");
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(PROV, f), "utf8");
const code = (/** @type {string} */ s) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("the provisioning tar carries the update's guards", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prov-")), "p.tgz");
  makeProvisionTar(REPO, out);
  const names = execFileSync("tar", ["-tzf", out], { encoding: "utf8" }).split("\n");
  for (const f of ["./update-lib.sh", "./update-guard.sh", "./files/arcade-update-recover", "./files/arcade-update-recover.service", "./files/arcade-boot"]) assert.ok(names.includes(f), f);
});

test("provisioning installs the guard on every first boot and update (D334)", () => {
  const p = read("provision.sh");
  assert.match(p, /\. "\$SELF_DIR\/update-guard\.sh"/);
  assert.ok(p.indexOf("step_update_guard\n") > p.indexOf("step_services\n"), "after the services");
  const g = read("update-guard.sh");
  assert.match(g, /systemctl enable arcade-update-recover\.service/);
  assert.match(g, /systemctl mask rpi-eeprom-update\.service/, "the bootloader never updates itself at boot (D335)");
  assert.match(g, /RuntimeWatchdogSec=/, "a hung kernel restarts the Pi (D336)");
});

test("an OS update never moves the boot packages, and never removes or adds a package (D335)", () => {
  const lib = read("update-lib.sh");
  const boot = /BOOT_PACKAGES="([^"]+)"/.exec(lib)?.[1].split(/\s+/) ?? [];
  for (const p of ["linux-image-*", "raspi-firmware", "rpi-eeprom", "firmware-brcm80211", "initramfs-tools*"]) assert.ok(boot.includes(p), p);
  const u = code(read("update-on-cabinet.sh"));
  assert.ok(u.indexOf("hold_boot") < u.indexOf(" upgrade ||"), "held before the upgrade");
  assert.doesNotMatch(u, /full-upgrade|dist-upgrade|autoremove|apt-get (-\S+ )*remove|purge/);
  assert.ok(u.indexOf('apt_save "$PAYLOAD/os-before"') < u.indexOf(" upgrade ||"), "a copy of each package is kept before");
});

test("the update refuses during a make, a game or a gate check (D332), before it records or changes anything", () => {
  const u = code(read("update-on-cabinet.sh"));
  const busy = u.indexOf('busy="$(busy_reason');
  assert.ok(busy > 0 && busy < u.indexOf("data-check.mjs\" record") && busy < u.indexOf('state_write "$STATE/pending"'));
  const lib = read("update-lib.sh");
  for (const why of ["a make is running", "still to be collected", "a game is being played", "the publish gate is checking a game"]) assert.match(lib, new RegExp(why));
});

test("pending is written before the first change and removed only after the result (D334)", () => {
  const u = code(read("update-on-cabinet.sh"));
  assert.ok(u.indexOf('state_write "$STATE/pending"') < u.indexOf('provision.sh" --profile'));
  const fin = u.slice(u.indexOf("finish() {"), u.indexOf("\n}", u.indexOf("finish() {")));
  assert.ok(fin.indexOf('mv "$temp" "$RESULT"') < fin.indexOf('rm -f "$STATE/pending"'));
  const r = code(read("files/arcade-update-recover"));
  assert.ok(r.indexOf('mv "$payload/result.json.new" "$payload/result.json"') < r.indexOf('rm -f "$P"\n  ulog "recovered'), "the recovery too");
  assert.match(r, /dpkg --configure -a/, "a package install the power cut stopped is finished first");
  // The update's own state is never under the data folder, so it can't touch a cart and the data check never sees it.
  assert.match(read("update-lib.sh"), /STATE="\$\{ARCADE_UPDATE_STATE:-\/var\/lib\/arcade-update\}"/);
});

test("the recovery and boot scripts never write to the data folder or the config", () => {
  for (const f of ["files/arcade-update-recover", "files/arcade-boot", "update-lib.sh", "update-guard.sh"]) {
    for (const line of code(read(f)).split("\n")) {
      assert.doesNotMatch(line, />\s*"?(\$DATA|\/var\/lib\/arcade\/|\/etc\/arcade\/service\.json)/, `${f}: ${line}`);
      assert.doesNotMatch(line, /rm .*(\$DATA|\/var\/lib\/arcade\/|service\.json)/, `${f}: ${line}`);
    }
  }
});

// arcade-boot's config.txt handling, run here: the same sed on the mini's bash as on the Pi's.
function bootFns() {
  const s = read("files/arcade-boot");
  const pick = (re) => s.match(re)?.[0] ?? assert.fail(`no ${re}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boot-"));
  const lib = path.join(dir, "fns.sh");
  fs.writeFileSync(lib, [pick(/^BEGIN=.*$/m), pick(/^END=.*$/m), pick(/^committed\(\) \{.*\}$/m), pick(/^config_with\(\) \{[\s\S]*?\n\}$/m)].join("\n") + "\n");
  const run = (/** @type {string} */ cmd) => execFileSync("bash", ["-c", `BOOT_DIR=${dir}; . ${lib}; ${cmd}`], { encoding: "utf8" });
  return { dir, run };
}

test("arcade-boot: a slot block is added, replaced and read back; the rest of config.txt is kept as it is (D336)", () => {
  const { dir, run } = bootFns();
  const original = "# the image's\ndtoverlay=vc4-kms-v3d,noaudio\n[cm5]\ndtoverlay=dwc2\n# BEGIN arcade provision\n[all]\ndtoverlay=picade\n# END arcade provision\n";
  fs.writeFileSync(path.join(dir, "config.txt"), original);
  assert.equal(run("committed"), "", "a fresh card boots from the top");
  fs.writeFileSync(path.join(dir, "config.txt"), run("config_with arcade-1"));
  assert.equal(run("committed").trim(), "arcade-1");
  const once = fs.readFileSync(path.join(dir, "config.txt"), "utf8");
  assert.ok(once.startsWith(original), "the rest stays, in order");
  assert.match(once, /\[all\]\nos_prefix=arcade-1\/\nkernel_watchdog_timeout=15\n# END arcade boot slot\n$/);
  fs.writeFileSync(path.join(dir, "config.txt"), run("config_with arcade-2"));
  const twice = fs.readFileSync(path.join(dir, "config.txt"), "utf8");
  assert.equal(run("committed").trim(), "arcade-2");
  assert.equal(twice.match(/os_prefix=/g)?.length, 1, "one block, replaced");
  assert.ok(twice.startsWith(original));
});

test("arcade-boot: a try writes tryboot.txt and a new folder only; keeping it rewrites config.txt last (D336)", () => {
  const s = code(read("files/arcade-boot"));
  const tryFn = s.slice(s.indexOf("cmd_try() {"), s.indexOf("cmd_confirm() {"));
  assert.doesNotMatch(tryFn, /config\.txt\.new|> "\$BOOT_DIR\/config\.txt"/, "a try never writes config.txt");
  assert.match(tryFn, /tryboot\.txt\.new.*mv/);
  assert.ok(tryFn.indexOf("state_write \"$TRY\"") < tryFn.indexOf('systemctl reboot "0 tryboot"'));
  assert.doesNotMatch(s, /systemctl reboot 0 tryboot/, "one argument, as Raspberry Pi's reboot '0 tryboot'");
  assert.match(tryFn, /grep -v '\^rpi-eeprom\$'/, "the bootloader is never part of a boot try");
  const confirm = s.slice(s.indexOf("cmd_confirm() {"));
  assert.ok(confirm.indexOf("net_ok") < confirm.indexOf("config.txt.new"), "kept only after the network and the service");
  assert.match(confirm, /arcade\.slot=\$id/, "knows a try by its own cmdline");
});

test("the update goes to the cabinet asked for (D330, D337)", () => {
  assert.deepEqual(updateTarget([]).env, {});
  const p = updateTarget(["--picade"], { GSA_CABINET_DIR: "/x/arcade" });
  assert.equal(p.name, "picade");
  assert.equal(p.env.ARCADE_HOST, "arcade.local");
  assert.equal(p.env.ARCADE_SSH_DIR, "/x/arcade/ssh");
  assert.equal(p.connect, "scripts/cabinet-card/connect-picade.sh");
  const r = updateTarget(["--rehearsal", "/r"], { REHEARSE_SSH_PORT: "2331" });
  assert.deepEqual([r.env.ARCADE_HOST, r.env.ARCADE_SSH_PORT, r.env.ARCADE_SSH_DIR, r.connect], ["127.0.0.1", "2331", "/r/cabinet/ssh", null]);
  assert.throws(() => updateTarget(["--rehearsal"]));
});

test("the brief is reapplied when the agent's definition changed, or the cabinet's commit is unknown (D330)", () => {
  assert.equal(agentChanged(REPO, ""), true);
  assert.equal(agentChanged(REPO, "abc+dirty"), true);
  const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const clean = execFileSync("git", ["status", "--porcelain", "--", "studio-kit/managed-agent"], { cwd: REPO, encoding: "utf8" }).trim() === "";
  if (clean) assert.equal(agentChanged(REPO, head), false);
  const first = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim().split("\n")[0];
  assert.equal(agentChanged(REPO, first), true, "the very first commit had no agent");
});

// mic.sh (D127) against stand-ins for utmctl, osascript, pgrep, up.sh, verify.sh and the driver.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { utmConfig } from "../lib.mjs";

const MIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../mic.sh");

function setup({ utm = true, vm = "started", phase = "idle", quits = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mic-"));
  const pkg = path.join(root, "arcade-virtual.utm");
  const bin = path.join(root, "bin");
  fs.mkdirSync(pkg);
  fs.mkdirSync(bin);
  const json = path.join(root, "c.json");
  fs.writeFileSync(json, JSON.stringify(utmConfig({ name: "arcade-virtual", uuid: "u", mac: "5a:47:41:43:41:42", network: "Both", bridgeInterface: "en1", cmdline: "c" })));
  execFileSync("plutil", ["-convert", "xml1", "-o", path.join(pkg, "config.plist"), json]);
  const calls = path.join(root, "calls");
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${calls}"\n${body}\n`, { mode: 0o755 });
  if (utm) fs.writeFileSync(path.join(root, "utm-running"), "");
  fs.writeFileSync(path.join(root, "vm"), vm);
  stub("pgrep", `[ -e "${root}/utm-running" ]`);
  stub("utmctl", `case "$1" in status) cat "${root}/vm" ;; stop) echo stopped > "${root}/vm" ;; esac`);
  stub("osascript", quits ? `rm -f "${root}/utm-running"` : "");
  stub("up", "");
  stub("verify", "");
  stub("drive", `case "$*" in *api/studio*) echo ${phase} ;; *arecord*) echo "card 0: virtio-snd" ;; esac`);
  const run = (arg) =>
    spawnSync("/bin/bash", [MIC, arg], {
      encoding: "utf8",
      env: { ...process.env, GSA_VM_DIR: root, GSA_UTMCTL: path.join(bin, "utmctl"), GSA_PGREP: path.join(bin, "pgrep"), GSA_OSASCRIPT: path.join(bin, "osascript"), GSA_UP: path.join(bin, "up"), GSA_VERIFY: path.join(bin, "verify"), GSA_DRIVE: path.join(bin, "drive"), GSA_VERIFY_OUT: path.join(root, "out") },
    });
  const log = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : []);
  const audioIn = () => execFileSync("plutil", ["-extract", "Virtualization.AudioInput", "raw", "-o", "-", path.join(pkg, "config.plist")], { encoding: "utf8" }).trim();
  return { root, pkg, run, log, audioIn };
}

test("on: stops the VM cleanly, quits UTM, sets AudioInput with a copy kept, starts hidden, then verifies", () => {
  const s = setup();
  assert.equal(s.run("--check").stdout.trim(), "off");
  const r = s.run("on");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.audioIn(), "true");
  const steps = s.log().map((l) => l.split(" ").slice(0, 2).join(" "));
  const order = ["utmctl stop", "osascript -e", "up ", "verify "].map((p) => steps.findIndex((x) => x.startsWith(p.trim())));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), steps.join("\n"));
  assert.ok(s.log().includes("utmctl stop --request arcade-virtual"), "a clean stop first");
  assert.ok(!s.log().some((l) => l.startsWith("killall")));
  const copies = fs.readdirSync(s.pkg).filter((f) => f.startsWith("config.plist.before-mic-"));
  assert.equal(copies.length, 1);
  assert.match(r.stdout, /Click Allow/);
  assert.match(r.stdout, /virtio-snd/);
  assert.equal(s.run("--check").stdout.trim(), "on");
});

test("it does nothing when the microphone is already as asked", () => {
  const s = setup();
  const r = s.run("off");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already off/);
  assert.deepEqual(s.log(), []);
});

test("it won't restart the cabinet during a make", () => {
  const s = setup({ phase: "running" });
  const r = s.run("on");
  assert.equal(r.status, 4);
  assert.equal(s.audioIn(), "false");
  assert.ok(!s.log().some((l) => l.startsWith("utmctl") || l.startsWith("up")));
});

test("if UTM won't quit, the config stays as it was", () => {
  const s = setup({ quits: false });
  const r = s.run("on");
  assert.equal(r.status, 3);
  assert.equal(s.audioIn(), "false");
  assert.equal(fs.readdirSync(s.pkg).length, 1, "no copy either");
});

test("with UTM not running it never calls utmctl, which would show UTM's window", () => {
  const s = setup({ utm: false });
  assert.equal(s.run("on").status, 0);
  assert.ok(!s.log().some((l) => l.startsWith("utmctl") || l.startsWith("osascript")));
  assert.equal(s.audioIn(), "true");
});

test("off turns it back off the same way", () => {
  const s = setup();
  s.run("on");
  assert.equal(s.run("off").status, 0);
  assert.equal(s.audioIn(), "false");
});

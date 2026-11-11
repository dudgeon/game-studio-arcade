// D244: networkd's wait-online stops holding boot where NetworkManager runs the network, on both profiles.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROVISION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cabinet/provision");
const LIB = path.join(PROVISION, "boot-wait.sh");

function run({ nm = true, networks = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootwait-"));
  const bin = path.join(dir, "bin");
  const etc = path.join(dir, "etc-network");
  fs.mkdirSync(bin);
  fs.mkdirSync(etc);
  for (const n of networks) fs.writeFileSync(path.join(etc, n), "");
  fs.writeFileSync(
    path.join(bin, "systemctl"),
    `#!/bin/bash\necho "systemctl $*" >> "${dir}/calls"\ncase "$*" in "is-enabled --quiet NetworkManager.service") ${nm ? "exit 0" : "exit 1"} ;; esac\n`,
    { mode: 0o755 },
  );
  const out = execFileSync("/bin/bash", ["-c", `set -euo pipefail; log() { echo "$*"; }; source "$0"; step_boot_wait`, LIB], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, NETWORKD_DIRS: `${etc} ${path.join(dir, "absent")}` },
  });
  const calls = fs.existsSync(path.join(dir, "calls")) ? fs.readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n") : [];
  return { out, calls };
}

test("with NetworkManager running the network, the wait is masked and this boot's failure cleared", () => {
  const { calls } = run();
  assert.ok(calls.includes("systemctl mask systemd-networkd-wait-online.service"));
  assert.ok(calls.includes("systemctl disable systemd-networkd-wait-online.service"));
  assert.ok(calls.includes("systemctl reset-failed systemd-networkd-wait-online.service"));
  assert.ok(!calls.some((c) => /NetworkManager-wait-online|mask systemd-networkd\.service/.test(c)), "only networkd's wait");
});

test("it leaves the wait alone where networkd has a network of its own", () => {
  const { calls, out } = run({ networks: ["10-eth0.network"] });
  assert.ok(!calls.some((c) => c.includes("mask")));
  assert.match(out, /networkd has networks/);
});

test("a .link file isn't a network to wait for", () => {
  assert.ok(run({ networks: ["99-default.link"] }).calls.some((c) => c.startsWith("systemctl mask")));
});

test("it leaves the wait alone where NetworkManager isn't running the network", () => {
  const { calls, out } = run({ nm: false });
  assert.ok(!calls.some((c) => c.includes("mask")));
  assert.match(out, /NetworkManager isn't enabled/);
});

test("provision.sh runs it for every profile, before the services start", () => {
  const p = fs.readFileSync(path.join(PROVISION, "provision.sh"), "utf8");
  assert.ok(p.includes('. "$SELF_DIR/boot-wait.sh"'));
  const steps = p.split("\n").filter((l) => /^(step_\w+|hw_\w+)$/.test(l));
  assert.ok(steps.indexOf("step_boot_wait") > steps.indexOf("hw_late"));
  assert.ok(steps.indexOf("step_boot_wait") < steps.indexOf("step_services"));
  for (const profile of ["picade", "virtual"]) assert.ok(!fs.readFileSync(path.join(PROVISION, `profiles/${profile}.sh`), "utf8").includes("wait-online"), `${profile} doesn't undo it`);
});

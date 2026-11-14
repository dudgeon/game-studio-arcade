#!/usr/bin/env node
// The Picade's boot update, a deliberate step (D336): kernel and boot firmware, through tryboot. Never part of an
// ordinary update and never from the Manager. Run it in a Terminal window on the mini when nobody's playing.
//
//   node scripts/cabinet-card/boot-update.mjs status            what the Picade boots now, and the last try
//   node scripts/cabinet-card/boot-update.mjs adopt             once: put what boots now in its own slot (no packages)
//   node scripts/cabinet-card/boot-update.mjs packages          update the boot packages into a new slot and try it
//   node scripts/cabinet-card/boot-update.mjs prove-revert      bring-up F3: a try that hangs on purpose; it must come back on its own
//   ... [--rehearsal DIR]                                       a QEMU rehearsal instead of the Picade (D337)
//
// The Picade restarts into the new slot for one boot only. It keeps the slot if it comes back with its network and
// the service; otherwise, or if it hangs (hardware watchdog), crashes or loses power, the next start is the old
// slot, and the boot packages are put back. This waits for the outcome, up to 20 minutes, then reports it.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { updateTarget } from "../virtual-cabinet/update-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRIVE = join(REPO, "cabinet/vm/drive");
const argv = process.argv.slice(2);
const [what] = argv;
const say = (m) => console.log(`[boot-update] ${m}`);
const stop = (m) => {
  console.error(`[boot-update] Stopped: ${m}`);
  process.exit(1);
};
if (!["status", "adopt", "packages", "prove-revert"].includes(what)) stop("say status, adopt, packages or prove-revert");
const target = updateTarget(argv.includes("--rehearsal") ? argv : ["--picade"]);
const ENV = { ...process.env, ...target.env, ARCADE_SSH_TIMEOUT_S: "60", ARCADE_RIDE_S: "30" };
/** @param {string} command */
const on = (command) => spawnSync(DRIVE, ["ssh", command], { encoding: "utf8", env: ENV });
const ARCADE_BOOT = "/usr/local/lib/arcade-update/arcade-boot";

const first = on(`sudo ${ARCADE_BOOT} status`);
if (first.status === 255) stop("can't reach the Picade. Is it on and on the Wi-Fi?");
if (first.status !== 0) stop(`the Picade has no boot updater yet: update it first (update-cabinet.mjs --picade). ${first.stderr.trim()}`);
console.log(first.stdout.trim());
if (what === "status") process.exit(0);

const before = on("sudo cat /var/lib/arcade-update/boot-result.json 2>/dev/null; cat /proc/sys/kernel/random/boot_id").stdout;
const bootId = before.trim().split("\n").pop();
// In its own unit, so the restart it asks for doesn't depend on this connection.
const r = on(`sudo systemd-run --quiet --unit=arcade-boot-try-${Date.now()} --wait --collect --pipe ${ARCADE_BOOT} try${what === "packages" ? " --packages" : what === "prove-revert" ? " --broken-for-test" : ""}`);
process.stdout.write(r.stdout);
if (r.status !== 0 && r.status !== 255) stop(`${r.stderr.trim() || "the try didn't start"}`);
if (/nothing to try/.test(r.stdout)) process.exit(0);
say("the Picade is restarting into the new slot; waiting for the outcome (up to 20 minutes)");
const deadline = Date.now() + 20 * 60 * 1000;
while (Date.now() < deadline) {
  spawnSync("sleep", ["10"]);
  const s = on("cat /proc/sys/kernel/random/boot_id; sudo test -e /var/lib/arcade-update/boot-try && echo trying || echo settled; sudo cat /var/lib/arcade-update/boot-result.json 2>/dev/null");
  if (s.status !== 0) continue;
  const [id, state, ...rest] = s.stdout.trim().split("\n");
  if (id === bootId || state !== "settled") continue;
  const res = JSON.parse(rest.join("\n") || "{}");
  console.log(JSON.stringify(res, null, 1));
  if (what === "prove-revert") {
    // The broken try must not have been kept, and the Pi must have come back by itself (bring-up F3).
    if (!res.ok && /didn't come up/.test(res.reason ?? "")) {
      say("the way back works: the broken try hung, and the Picade came back on its last slot by itself");
      process.exit(0);
    }
    stop(`the broken try didn't come back as it should: ${res.reason}`);
  }
  if (!res.ok) stop(res.reason ?? "the try didn't stick");
  say(res.reason);
  process.exit(0);
}
stop("no outcome after 20 minutes. The Picade may be restarting between slots; check: boot-update.mjs status");

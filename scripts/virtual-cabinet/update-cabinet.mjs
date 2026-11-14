#!/usr/bin/env node
// Puts this checkout's cabinet software on a running cabinet, keeping its carts, logs and key (D4, D5, D195),
// and with --os its OS packages too (D330, D335). A rebuild destroys all three, so this is the normal way to ship a fix.
//
//   node scripts/virtual-cabinet/update-cabinet.mjs [--picade | --rehearsal DIR] [--os] [--no-agent] [--allow-dirty]
//
//   --picade          the real cabinet, by its own key (picade-ssh.sh, D259); default the virtual cabinet
//   --rehearsal DIR   a QEMU rehearsal of the card (scripts/cabinet-card/rehearse.mjs), REHEARSE_SSH_PORT
//   --os              OS packages too: everything but the boot packages and apt.lock's (D335)
//   --no-agent        don't reapply the Studio agent's brief, even if it changed (D330)
//
// It sends the bundle over SSH and the cabinet runs the update itself, in its own systemd unit, so a dropped
// connection (D156) can't stop it halfway. It won't start during a make, a game or a gate check (D332). The
// cabinet checks every data file before and after (D196), rolls back if it isn't healthy after (D331, D333), and
// puts itself back at the next boot if the power goes partway (D334). Then, if the Studio agent's definition
// changed since the cabinet's last update, it reapplies the brief in the cabinet's own workspace (connect --reapply).
// The kernel and boot firmware never move here: scripts/cabinet-card/boot-update.mjs (D336).
// The cabinet needs network to reach npm and any changed apt packages.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_PATHS, makeBundle, makeProvisionTar, miniTimezone } from "./lib.mjs";
import { agentChanged, updateTarget } from "./update-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRIVE = join(REPO, "cabinet/vm/drive");
const argv = process.argv.slice(2);
const allowDirty = argv.includes("--allow-dirty");
const withOs = argv.includes("--os");
const say = (m) => console.log(`[update] ${m}`);
const stop = (m) => {
  console.error(`[update] Stopped: ${m}`);
  process.exit(1);
};
let target;
try {
  target = updateTarget(argv);
} catch (e) {
  stop(e.message);
}
const ENV = { ...process.env, ...target.env, ARCADE_SSH_TIMEOUT_S: "120" };
const git = (...a) => spawnSync("git", a, { cwd: REPO, encoding: "utf8" }).stdout.trim();
const SSH_FAILED = 255;

/** Over the cabinet's own SSH, retrying while the path is down. Exit 255 only ever means SSH itself failed. */
function cabinet(command, { input, tries = 72 } = {}) {
  for (let i = 0; ; i++) {
    // Each try is limited: a stuck connection exits 255 like any other SSH failure.
    const r = spawnSync(DRIVE, ["ssh", command], { input, encoding: input && typeof input !== "string" ? "buffer" : "utf8", maxBuffer: 2 ** 26, env: ENV });
    if (r.status !== SSH_FAILED) return r;
    if (i >= tries) stop(`can't reach the ${target.name} cabinet after ${tries * 5} s. Is it on, and on the network?`);
    if (i === 0) say("waiting for the cabinet to answer");
    spawnSync("sleep", ["5"]);
  }
}

const commit = git("rev-parse", "--short=12", "HEAD");
const dirty = git("status", "--porcelain", "--", ...BUNDLE_PATHS, "cabinet/provision");
if (dirty && !allowDirty) stop(`uncommitted changes in what goes to the cabinet:\n${dirty}\nCommit them, or pass --allow-dirty for a test.`);
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") say(`note: this checkout is on ${branch}, not main`);
const label = `${commit}${dirty ? "+dirty" : ""}`;

const work = mkdtempSync(join(tmpdir(), "cabinet-update-"));
let result = null;
let cabinetCommitBefore = "";
try {
  const bundle = join(work, "bundle.tar.gz");
  const provision = join(work, "provision.tar.gz");
  makeBundle(REPO, bundle);
  makeProvisionTar(REPO, provision);
  const update = readFileSync(join(REPO, "cabinet/provision/update-on-cabinet.sh"));
  const payloadId = createHash("sha256").update(readFileSync(bundle)).update(readFileSync(provision)).update(withOs ? "os" : "").digest("hex").slice(0, 12);
  const dir = `/var/lib/arcade-update/${Date.now()}-${payloadId}`;
  writeFileSync(join(work, "commit"), `${label}\n`);
  cabinetCommitBefore = String(cabinet("cat /etc/arcade/provisioned-commit 2>/dev/null || true").stdout).trim();
  say(`sending ${label} to the ${target.name} cabinet${withOs ? ", with its OS packages" : ""}, payload ${payloadId}`);

  // Each file is written beside its final name and checked by hash, so a repeat after a gap is harmless.
  const send = (name, data) => {
    const want = createHash("sha256").update(data).digest("hex");
    const r = cabinet(`sudo mkdir -p ${dir} && sudo tee ${dir}/${name}.part >/dev/null && test "$(sudo sha256sum ${dir}/${name}.part | cut -d' ' -f1)" = ${want} && sudo mv ${dir}/${name}.part ${dir}/${name}`, { input: data });
    if (r.status !== 0) stop(`couldn't send ${name}: ${String(r.stderr).slice(0, 300)}`);
  };
  send("bundle.tar.gz", readFileSync(bundle));
  send("provision.tar.gz", readFileSync(provision));
  send("commit", readFileSync(join(work, "commit")));
  // The mini's time zone, which the cabinet's dates and the pot's month follow (D246).
  send("timezone", Buffer.from(`${miniTimezone()}\n`));
  if (withOs) send("os", Buffer.from("upgrade\n"));
  send("update-on-cabinet.sh", update);

  const unit = `arcade-update-${payloadId}-${Date.now()}`;
  const started = cabinet(`sudo systemd-run --quiet --unit=${unit} /bin/bash ${dir}/update-on-cabinet.sh ${dir}`);
  if (started.status !== 0) stop(`couldn't start the update: ${String(started.stderr).slice(0, 300)}`);
  say("the cabinet is updating itself");

  // A first update installs its packages, and OS packages take longer, so give it time. It reports through result.json.
  const deadline = Date.now() + (withOs ? 60 : 20) * 60 * 1000;
  while (Date.now() < deadline) {
    const r = cabinet(`sudo cat ${dir}/result.json 2>/dev/null || echo waiting`);
    const text = String(r.stdout).trim();
    if (text.startsWith("{")) {
      result = JSON.parse(text);
      break;
    }
    spawnSync("sleep", ["5"]);
  }
  if (!result) stop(`no result after ${withOs ? 60 : 20} minutes. On the cabinet: sudo cat ${dir}/update.log`);

  console.log(JSON.stringify(result, null, 1));
  if (!result.ok) stop(`${result.reason}${result.rolled_back ? ". It went back to what it had" : ""}. Log on the cabinet: ${dir}/update.log`);
  if (result.version_before === result.version_after) say(`software already on ${result.version_after}: nothing moved`);
  else say(`updated from ${result.version_before} to ${result.version_after}`);
  if (result.os) say(`OS packages: ${result.os.changed} updated${result.os.changed ? "; the next start checks the network and puts them back if it's gone (D333)" : ""}`);
  if (result.restart_wanted) say("some of this takes effect at the next restart of the cabinet; restart it when nobody's playing");
  const d = result.data ?? {};
  say(`all ${d.files ?? "?"} data files kept${d.grown?.length ? `, ${d.grown.length} logs grew` : ""}${d.new_logs?.length ? `, ${d.new_logs.length} new logs` : ""}; config untouched`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// The Studio agent's brief, in the cabinet's own workspace, when its definition changed (D330).
if (target.connect && !argv.includes("--no-agent")) {
  const live = String(cabinet("sudo test -e /etc/arcade/service.json && echo live || echo offline").stdout).trim();
  if (live !== "live") say("the cabinet isn't connected to Claude yet: no agent brief to reapply");
  else if (!agentChanged(REPO, cabinetCommitBefore.replace(/\+dirty$/, "x"))) say("the Studio agent hasn't changed since the cabinet's last update: brief left as it is");
  else {
    say("the Studio agent changed: reapplying its brief in the cabinet's workspace");
    const r = spawnSync(join(REPO, target.connect), ["--reapply"], { stdio: "inherit", env: process.env });
    if (r.status !== 0) stop(`the software updated, but the brief didn't reapply. Run it again: ${target.connect} --reapply`);
  }
}

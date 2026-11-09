#!/usr/bin/env node
// Puts this checkout's cabinet software on a running cabinet, keeping its carts, logs and key (D4, D5, D195).
// A rebuild destroys all three, so this is the normal way to ship a fix.
//
//   node scripts/virtual-cabinet/update-cabinet.mjs [--allow-dirty]
//
// It sends the bundle over SSH and the cabinet runs the update itself, in its own systemd unit, so a dropped
// connection (D156) can't stop it halfway. The cabinet compares carts, logs and config before and after, and
// rolls back if the service doesn't return. It won't start while a make is running. ARCADE_HOST picks the cabinet.
// The cabinet needs network to reach npm and any changed apt packages.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_PATHS, makeBundle, makeProvisionTar } from "./lib.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRIVE = join(REPO, "cabinet/vm/drive");
const allowDirty = process.argv.includes("--allow-dirty");
const say = (m) => console.log(`[update] ${m}`);
const stop = (m) => {
  console.error(`[update] Stopped: ${m}`);
  process.exit(1);
};
const git = (...a) => spawnSync("git", a, { cwd: REPO, encoding: "utf8" }).stdout.trim();
const SSH_FAILED = 255;

/** Over the cabinet's own SSH, retrying while the path is down. Exit 255 only ever means SSH itself failed. */
function cabinet(command, { input, tries = 72 } = {}) {
  for (let i = 0; ; i++) {
    const r = spawnSync(DRIVE, ["ssh", command], { input, encoding: input && typeof input !== "string" ? "buffer" : "utf8", maxBuffer: 2 ** 26 });
    if (r.status !== SSH_FAILED) return r;
    if (i >= tries) stop(`can't reach the cabinet after ${tries * 5} s. Is it running? scripts/virtual-cabinet/up.sh`);
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
try {
  const bundle = join(work, "bundle.tar.gz");
  const provision = join(work, "provision.tar.gz");
  makeBundle(REPO, bundle);
  makeProvisionTar(REPO, provision);
  const update = readFileSync(join(REPO, "cabinet/provision/update-on-cabinet.sh"));
  const payloadId = createHash("sha256").update(readFileSync(bundle)).update(readFileSync(provision)).digest("hex").slice(0, 12);
  const dir = `/var/lib/arcade-update/${Date.now()}-${payloadId}`;
  writeFileSync(join(work, "commit"), `${label}\n`);
  say(`sending ${label} to the cabinet, payload ${payloadId}`);

  // Each file is written beside its final name and checked by hash, so a repeat after a gap is harmless.
  const send = (name, data) => {
    const want = createHash("sha256").update(data).digest("hex");
    const r = cabinet(`sudo mkdir -p ${dir} && sudo tee ${dir}/${name}.part >/dev/null && test "$(sudo sha256sum ${dir}/${name}.part | cut -d' ' -f1)" = ${want} && sudo mv ${dir}/${name}.part ${dir}/${name}`, { input: data });
    if (r.status !== 0) stop(`couldn't send ${name}: ${String(r.stderr).slice(0, 300)}`);
  };
  send("bundle.tar.gz", readFileSync(bundle));
  send("provision.tar.gz", readFileSync(provision));
  send("commit", readFileSync(join(work, "commit")));
  send("update-on-cabinet.sh", update);

  const unit = `arcade-update-${payloadId}-${Date.now()}`;
  const started = cabinet(`sudo systemd-run --quiet --unit=${unit} /bin/bash ${dir}/update-on-cabinet.sh ${dir}`);
  if (started.status !== 0) stop(`couldn't start the update: ${String(started.stderr).slice(0, 300)}`);
  say("the cabinet is updating itself");

  // A first update installs its packages, so give it time. It reports through result.json.
  const deadline = Date.now() + 20 * 60 * 1000;
  let result = null;
  while (Date.now() < deadline) {
    const r = cabinet(`sudo cat ${dir}/result.json 2>/dev/null || echo waiting`);
    const text = String(r.stdout).trim();
    if (text.startsWith("{")) {
      result = JSON.parse(text);
      break;
    }
    spawnSync("sleep", ["5"]);
  }
  if (!result) stop(`no result after 20 minutes. On the cabinet: sudo cat ${dir}/update.log`);

  console.log(JSON.stringify(result, null, 1));
  if (!result.ok) stop(`${result.reason}${result.rolled_back ? ". It rolled back to the version it had" : ""}. Log on the cabinet: ${dir}/update.log`);
  if (result.version_before === result.version_after) say(`already on ${result.version_after}: nothing moved`);
  else say(`updated from ${result.version_before} to ${result.version_after}`);
  say("carts and logs kept, config untouched");
} finally {
  rmSync(work, { recursive: true, force: true });
}

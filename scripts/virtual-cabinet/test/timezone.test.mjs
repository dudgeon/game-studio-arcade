// D246: every cabinet takes the mini's time zone, one way: a "timezone" file in each payload, set by provision.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { miniTimezone, zoneFromLink } from "../lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LIB = path.join(REPO, "cabinet/provision/timezone.sh");

function run(payloadZone, { current = "Europe/London" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tz-"));
  const zi = path.join(root, "zoneinfo");
  const etc = path.join(root, "etc");
  const payload = path.join(root, "payload");
  for (const z of ["Europe/London", "America/New_York", "UTC"]) {
    fs.mkdirSync(path.dirname(path.join(zi, z)), { recursive: true });
    fs.writeFileSync(path.join(zi, z), z);
  }
  fs.mkdirSync(etc);
  fs.mkdirSync(payload);
  fs.symlinkSync(path.join(zi, current), path.join(etc, "localtime"));
  fs.writeFileSync(path.join(etc, "timezone"), `${current}\n`);
  if (payloadZone != null) fs.writeFileSync(path.join(payload, "timezone"), `${payloadZone}\n`);
  const out = execFileSync("/bin/bash", ["-c", 'set -euo pipefail; log() { echo "$*"; }; source "$0"; step_timezone', LIB], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", ZONEINFO: zi, ETC_DIR: etc, PAYLOAD: payload },
  });
  return { out, link: fs.readlinkSync(path.join(etc, "localtime")).slice(zi.length + 1), file: fs.readFileSync(path.join(etc, "timezone"), "utf8").trim() };
}

test("provision sets the payload's zone, link and /etc/timezone together", () => {
  const r = run("America/New_York");
  assert.equal(r.link, "America/New_York");
  assert.equal(r.file, "America/New_York");
  assert.match(r.out, /time zone set to America\/New_York \(was Europe\/London\)/);
});

test("it's quiet when the zone is already right", () => {
  const r = run("Europe/London");
  assert.equal(r.out, "");
  assert.equal(r.link, "Europe/London");
});

test("no zone in the payload, an unknown zone, or a bad name leaves the cabinet's zone alone", () => {
  for (const z of [null, "Mars/Olympus", "../../etc/passwd", "x; rm -rf /", ""]) {
    const r = run(z);
    assert.equal(r.link, "Europe/London", String(z));
    assert.equal(r.file, "Europe/London", String(z));
  }
});

test("the zone comes from the mini's /etc/localtime link", () => {
  assert.equal(zoneFromLink("/var/db/timezone/zoneinfo/America/New_York\n"), "America/New_York");
  assert.equal(zoneFromLink("/usr/share/zoneinfo/UTC"), "UTC");
  assert.equal(zoneFromLink("/etc/nothing"), null);
  assert.match(miniTimezone(), /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/);
  process.env.ARCADE_TIMEZONE = "Asia/Tokyo";
  try { assert.equal(miniTimezone(), "Asia/Tokyo"); } finally { delete process.env.ARCADE_TIMEZONE; }
});

test("one way for both cabinets: every payload carries the mini's zone, and provision applies it early for both profiles", () => {
  const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
  assert.match(src("scripts/virtual-cabinet/build.mjs"), /join\(seed, "timezone"\), `\$\{miniTimezone\(\)\}/);
  assert.match(src("scripts/cabinet-card/flash.mjs"), /join\(dir, "timezone"\), `\$\{timezone\}/);
  assert.match(src("scripts/cabinet-card/flash.mjs"), /opt\("--timezone", miniTimezone\(\)\)/);
  assert.match(src("scripts/virtual-cabinet/update-cabinet.mjs"), /send\("timezone", Buffer\.from\(`\$\{miniTimezone\(\)\}/);
  const steps = src("cabinet/provision/provision.sh").split("\n").filter((l) => /^(step_\w+|hw_\w+)$/.test(l));
  assert.ok(steps.indexOf("step_timezone") >= 0 && steps.indexOf("step_timezone") < steps.indexOf("step_services"));
  for (const p of ["picade", "virtual"]) assert.ok(!src(`cabinet/provision/profiles/${p}.sh`).includes("localtime"), `${p} doesn't set its own`);
});

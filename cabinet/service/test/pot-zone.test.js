// D247: the pot's month is the cabinet's local month (D202), and a time zone change can't refill twice or skip one.
// Each step runs in its own Node process with TZ set, as the service does after a zone change and restart.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/pot.js");

/** Read the pot's state in zone TZ at instant AT, against the ledger in DIR. */
function stateAt(dir, tz, at) {
  const code = `import { potStore } from ${JSON.stringify(POT)};
    const s = potStore({ logsDir: process.argv[1], now: () => new Date(process.argv[2]) }).state();
    console.log(JSON.stringify({ month: s.month, coins: s.coins, refill_on: s.refill_on }));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code, dir, at], { encoding: "utf8", env: { ...process.env, TZ: tz } }));
}
const ledger = (dir) => fs.readFileSync(path.join(dir, "coin_ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const refills = (dir) => ledger(dir).filter((e) => e.kind === "refill").map((e) => e.month);

test("the month is the cabinet's local one: 02:00 UTC on the 1st is still last month in New York", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  assert.equal(stateAt(dir, "America/New_York", "2026-12-01T02:00:00Z").month, "2026-11");
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  assert.equal(stateAt(d2, "Europe/London", "2026-12-01T02:00:00Z").month, "2026-12");
  assert.equal(stateAt(d2, "America/New_York", "2026-11-12T12:00:00Z").refill_on, "2026-12-01");
});

test("changing zone mid-month keeps this month's one refill: no second, none lost", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  stateAt(dir, "Europe/London", "2026-11-12T23:00:00Z");
  stateAt(dir, "America/New_York", "2026-11-13T02:00:00Z"); // Nov 12, 21:00 in New York: the same month
  stateAt(dir, "America/New_York", "2026-11-20T12:00:00Z");
  assert.deepEqual(refills(dir), ["2026-11"]);
});

test("a change across the 1st still gives each month exactly one refill", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  stateAt(dir, "Europe/London", "2026-11-20T12:00:00Z");
  stateAt(dir, "Europe/London", "2026-12-01T02:00:00Z"); // December in London: refills
  assert.equal(stateAt(dir, "America/New_York", "2026-12-01T03:00:00Z").month, "2026-11"); // back to Nov 30 in New York
  stateAt(dir, "America/New_York", "2026-12-01T05:30:00Z"); // Dec 1, 00:30 in New York
  stateAt(dir, "America/New_York", "2027-01-01T05:30:00Z");
  assert.deepEqual(refills(dir), ["2026-11", "2026-12", "2027-01"]);
});

test("the history's dates are the cabinet's local days: an evening make in New York isn't tomorrow (D248)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  const code = `import { potStore } from ${JSON.stringify(POT)};
    const p = potStore({ logsDir: process.argv[1], now: () => new Date("2026-11-13T03:08:10Z") });
    console.log(JSON.stringify(p.history().map((e) => ({ at: e.at, day: e.day }))));`;
  const h = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code, dir], { encoding: "utf8", env: { ...process.env, TZ: "America/New_York" } }));
  assert.deepEqual(h, [{ at: "2026-11-13T03:08:10.000Z", day: "2026-11-12" }]);
  const { historyLines } = await import("../launcher/boards.js");
  const text = (/** @type {any} */ e) => historyLines([e]).map((l) => l.text).join(" ");
  const local = text({ kind: "refill", at: "2026-11-13T03:08:10Z", day: "2026-11-12", pot_after_cents: 1000 });
  const utc = text({ kind: "refill", at: "2026-11-13T03:08:10Z", pot_after_cents: 1000 });
  assert.notEqual(local, utc, "the screen uses the local day when the service gives one");
});

test("a change the other way, onto a zone already in the new month, refills at once, once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pot-"));
  stateAt(dir, "America/New_York", "2026-12-01T03:00:00Z"); // Nov 30 in New York
  stateAt(dir, "Europe/London", "2026-12-01T03:30:00Z"); // Dec 1 in London
  stateAt(dir, "America/New_York", "2026-12-01T06:00:00Z"); // Dec 1 in New York too
  assert.deepEqual(refills(dir), ["2026-11", "2026-12"]);
});

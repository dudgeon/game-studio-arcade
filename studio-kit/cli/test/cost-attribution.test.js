// Runs the cost attribution on the recorded penguin-catch session and pins the
// numbers docs/cost-penguin-catch.md is built on. Prices are the script's table,
// so a price change that moves these is meant to be noticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { activeSeconds, attribute, bill, parseEvents, requestsOf, runtimeCents, simulate, stepsOf, thinkingRange } from "../scripts/cost-attribution.js";

const eventsFile = fileURLToPath(new URL("../fixtures/penguin-catch/events.jsonl", import.meta.url));
const script = fileURLToPath(new URL("../scripts/cost-attribution.js", import.meta.url));
const events = parseEvents(fs.readFileSync(eventsFile, "utf8"));
const reqs = requestsOf(events);
const a = attribute(reqs);
const runtime = runtimeCents(activeSeconds(events));

/** @param {number} actual @param {number} expected @param {number} [within] */
const near = (actual, expected, within = 0.005) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);

test("the recorded session reconciles to 68.00c, its logged list cost", () => {
  const b = bill(reqs);
  assert.deepEqual(b.tokens, { input: 46, output: 30313, write: 110101, read: 955184 });
  assert.equal((b.tokenCents + runtime).toFixed(2), "68.00");
  const usage = events.filter((e) => e.type === "session.usage").at(-1).usage;
  assert.equal(usage.list_cost.amount, "68");
});

test("each token is charged once: own costs, expiry and input add up to the token bill", () => {
  const own = a.rows.reduce((s, r) => s + r.ownCents, 0) + a.start.cents;
  near(own + a.expiryCents + a.inputCents, a.tokenCents, 1e-6);
});

test("it finds the prefix growth, the tool output and the one cache expiry", () => {
  assert.equal(reqs.length, 22);
  assert.equal(a.start.tokens, 7461);
  assert.equal(a.finalPrefix, 73118);
  assert.equal(a.rows.reduce((s, r) => s + r.returned, 0), 35970);
  assert.deepEqual(a.rows.filter((r) => r.rewritten > 0).map((r) => [r.n, r.rewritten]), [[8, 36983]]);
  near(a.expiryCents, 8.88);
  near(a.rows[14].output, 11046);
  assert.equal(a.rows[2].returned, 11694);
});

test("the what-ifs give the doc's savings", () => {
  const start = a.start.tokens;
  const steps = stepsOf(a.rows);
  const asBuilt = simulate(steps, { start, expiryAt: 7 });
  near(asBuilt.cents, a.tokenCents);
  assert.equal(asBuilt.peak, 73118);
  near(asBuilt.cents - simulate(steps, { start }).cents, 8.88);
  const noFixes = steps.filter((s) => ![16, 17, 18].includes(s.n ?? 0));
  near(asBuilt.cents - simulate(noFixes, { start, expiryAt: 7 }).cents, 5.22);
  near(simulate(steps, { start, expiryAt: 7, model: "haiku" }).cents + runtime, 4.45);
  near(simulate(steps, { start, expiryAt: 7, model: "opus" }).cents + runtime, 135.4);
});

test("the thinking estimate stays in the doc's range", () => {
  const t = thinkingRange(reqs);
  near(t.low, 11000, 300);
  near(t.high, 12900, 300);
});

test("the command line prints the total and runs a what-if", () => {
  const out = execFileSync(process.execPath, [script, eventsFile], { encoding: "utf8" });
  assert.match(out, /TOTAL 68\.00c/);
  const what = JSON.parse(execFileSync(process.execPath, [script, eventsFile, "--no-expiry", "--json", "--drop", "16,17,18"], { encoding: "utf8" }));
  const noFixes = stepsOf(a.rows).filter((s) => ![16, 17, 18].includes(s.n ?? 0));
  near(what.cents, simulate(noFixes, { start: a.start.tokens }).cents + runtime, 1e-6);
});

// Runs the cost attribution on the recorded penguin-catch session and pins the
// numbers docs/cost-penguin-catch.md is built on. Prices are the script's table,
// so a price change that moves these is meant to be noticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { activeSeconds, attribute, bill, loggedCents, modelKey, parseEvents, requestsOf, runtimeCents, simulate, stepsOf, thinkingRange } from "../scripts/cost-attribution.js";

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

/** A tiny recorded session: one request per prompt size, with a logged list cost. */
function session(usages, listCost) {
  const lines = [];
  usages.forEach((u, i) => {
    lines.push({ id: `s${i}`, type: "span.model_request_start", processed_at: "2026-11-08T00:00:00Z" });
    lines.push({ id: `e${i}`, type: "span.model_request_end", model_request_start_id: `s${i}`, processed_at: "2026-11-08T00:00:01Z", model_usage: u });
  });
  lines.push({ id: "u", type: "session.usage", usage: { active_seconds: 0, list_cost: { amount: String(listCost), currency: "USD" } } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const usage = (read, output = 1000) => ({ input_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: read, output_tokens: output });

test("--model prices the run as recorded, with the full table, not as a what-if", () => {
  const file = session([usage(50_000)], 0);
  const r = run(file, "--model", "haiku");
  assert.match(r.stdout, /# prefix written/, "the per-request table");
  assert.match(r.stdout, /TOTAL 0\.11c as haiku; the session logged 0c/);
  assert.doesNotMatch(r.stdout, /what-if/);
  const json = JSON.parse(run(file, "--model", "opus", "--json").stdout);
  assert.equal(json.model, "opus");
  near(json.totalCents, 2.5 + 1, 0.01);
  assert.ok(json.rows.length === 1);
});

test("--model charges Haiku's over-100k rate request by request", () => {
  const under = JSON.parse(run(session([usage(90_000)], 0), "--model", "haiku", "--json").stdout);
  const over = JSON.parse(run(session([usage(110_000)], 1), "--model", "haiku", "--json").stdout);
  near(under.totalCents, (90_000 * 0.01 + 1000 * 0.125 + 1000 * 0.5) / 1e4, 1e-6);
  near(over.totalCents, (110_000 * 0.05 + 1000 * 0.625 + 1000 * 2.5) / 1e4, 1e-6);
});

test("full model ids work", () => {
  assert.equal(modelKey("claude-haiku-5-5"), "haiku");
  assert.equal(modelKey("opus"), "opus");
  assert.equal(modelKey("gpt"), "gpt");
  assert.notEqual(run(eventsFile, "--model", "gpt").status, 0);
});

test("a total that disagrees with the logged cost warns; a match doesn't", () => {
  assert.equal(loggedCents(events), 68);
  const right = run(eventsFile, "--model", "claude-sonnet-5-5");
  assert.match(right.stdout, /TOTAL 68\.00c as sonnet; the session logged 68c/);
  assert.equal(right.stderr, "");
  const wrong = run(eventsFile, "--model", "haiku");
  assert.match(wrong.stderr, /warning: priced as haiku .* but the session logged 68c/);
  assert.equal(wrong.status, 0);
});

test("--what-if still re-simulates on another model", () => {
  const what = JSON.parse(run(eventsFile, "--what-if", "--model", "haiku", "--json").stdout);
  assert.equal(what.model, "haiku");
  near(what.cents, simulate(stepsOf(a.rows), { start: a.start.tokens, model: "haiku", expiryAt: 7 }).cents + runtime, 1e-6);
  assert.ok(!("rows" in what));
  assert.match(run(eventsFile, "--what-if", "--model", "haiku").stdout, /^what-if \(haiku/);
});

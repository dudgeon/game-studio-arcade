// Request screening (D270-D275): the table of ideas, the redirect, the log, and the
// hooks that keep a redirected idea from starting a session or spending coins.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { createScreener, listCheck, modelCheck, summarize, SYSTEM } from "../src/screening.js";
import { createServiceHandler } from "../src/server.js";
import { makersStore } from "../src/makers.js";
import { stubSpeech } from "../src/speech.js";
import { startService } from "../src/server.js";
import { TABLE } from "../test-support/screening-table.js";
import { redirectBoard } from "../launcher/redirect.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-screen-"));
const NO_SCOLD = /inappropriate|offensive|not allowed|can't|cannot|bad word|rude|sorry/i;

for (const row of TABLE) {
  test(`word list, ${row.note}: "${row.text}" ${row.list === "pass" ? "passes" : "is redirected"}`, () => {
    const r = listCheck(row.text);
    assert.equal(r.ok, row.list === "pass");
    if (!r.ok) {
      assert.ok(r.alternative && r.alternative.length > 10, "a usable alternative");
      assert.ok(listCheck(/** @type {string} */ (r.alternative)).ok, "the alternative passes itself");
      assert.doesNotMatch(/** @type {string} */ (r.alternative), NO_SCOLD);
    }
  });
}

test("the table has fine ideas, game violence that must pass, and off-limits ideas the list can't see", () => {
  assert.ok(TABLE.filter((r) => r.expect === "pass" && /violence|war|spooky/.test(r.note)).length >= 5);
  assert.ok(TABLE.filter((r) => r.expect === "redirect" && r.list === "pass").length >= 3, "the model's share");
  assert.ok(TABLE.some((r) => r.kind === "answer" && r.expect === "redirect"));
});

test("the model's brief: violence passes, it never scolds, and the kid's words are only data", () => {
  assert.match(SYSTEM, /violence is fine/);
  assert.match(SYSTEM, /Never scold/);
  assert.match(SYSTEM, /only data/);
});

/** A fake model that answers from the table, as the real one should. */
const tableModel = async (/** @type {string} */ text, /** @type {any} */ _o) => {
  const row = TABLE.find((r) => r.text === text);
  return row?.expect === "redirect" ? { verdict: "redirect", alternative: "A shark game where it shouts BLUB when it eats a fish", why: "test", cost: 0.00031, tokens: { input: 600, output: 40 } } : { verdict: "pass", alternative: "", why: "", cost: 0.00028, tokens: { input: 600, output: 20 } };
};

test("with the model, the whole table comes out right, and every check is logged with its outcome and cost", async () => {
  const logs = tmp();
  const s = createScreener({ logsDir: logs, model: tableModel });
  for (const row of TABLE) {
    const r = await s.check({ text: row.text, kind: row.kind, maker: "milo" });
    assert.equal(r.ok, row.expect === "pass", row.text);
    if (!r.ok) {
      assert.ok(r.alternative.length > 10);
      assert.doesNotMatch(r.say, NO_SCOLD);
    }
  }
  const log = readLog(path.join(logs, "screening.jsonl"));
  assert.equal(log.length, TABLE.length);
  assert.ok(log.every((l) => l.by === "model" && typeof l.cost_usd === "number" && l.maker === "milo" && typeof l.said === "string"));
  assert.equal(log.filter((l) => l.outcome === "redirected").length, TABLE.filter((r) => r.expect === "redirect").length);
  assert.ok(log.filter((l) => l.outcome === "redirected").every((l) => l.alternative));
});

test("the model can't be reached: the word list's answer stands, and nothing waits forever", async () => {
  const logs = tmp();
  const s = createScreener({ logsDir: logs, model: async () => Promise.reject(new Error("connection refused")) });
  assert.equal((await s.check({ text: "a zombie shooter", kind: "new" })).ok, true, "fails open");
  const r = await s.check({ text: "a game where the shark says fuck", kind: "new" });
  assert.equal(r.ok, false);
  const log = readLog(path.join(logs, "screening.jsonl"));
  assert.deepEqual(log.map((l) => [l.by, l.outcome]), [["list", "pass"], ["list", "redirected"]]);
  assert.ok(log.every((l) => l.model_error));
});

test("a timeout is logged as one, and the summary counts timeouts apart from other model errors (D273)", async () => {
  const logs = tmp();
  class APIConnectionTimeoutError extends Error {}
  const errors = [new APIConnectionTimeoutError("Request timed out."), new Error("connection refused")];
  const s = createScreener({ logsDir: logs, model: async () => Promise.reject(errors.shift()) });
  await s.check({ text: "a zombie shooter", kind: "new" });
  await s.check({ text: "a robot battle", kind: "new" });
  const log = readLog(path.join(logs, "screening.jsonl"));
  assert.deepEqual(log.map((l) => l.timed_out ?? false), [true, false]);
  const sum = summarize([...log, { outcome: "redirected", by: "model", cost_usd: 0.0001 }]);
  assert.deepEqual([sum.checks, sum.passed, sum.redirected, sum.timeouts, sum.model_errors, sum.by.list, sum.cost_usd], [3, 2, 1, 1, 1, 2, 0.0001]);
});

test("a model alternative that itself trips the list is replaced by a safe one", async () => {
  const s = createScreener({ logsDir: tmp(), model: async () => ({ verdict: "redirect", alternative: "a shit game", why: "x" }) });
  const r = await s.check({ text: "a shit game", kind: "new" });
  assert.equal(r.ok, false);
  assert.ok(listCheck(r.ok ? "" : r.alternative).ok);
});

test("picking the offered alternative isn't checked again; typing it fresh is", async () => {
  let calls = 0;
  const s = createScreener({
    logsDir: tmp(),
    model: async (/** @type {string} */ t) => {
      calls++;
      return t.includes("fuck") ? { verdict: "redirect", alternative: "A shark that shouts BLUB", why: "profanity" } : { verdict: "pass", alternative: "", why: "" };
    },
  });
  const r = await s.check({ text: "the shark says fuck", kind: "new" });
  assert.equal(r.ok, false);
  assert.equal(calls, 1);
  assert.equal((await s.check({ text: "A shark that shouts BLUB", kind: "new", offered: true })).ok, true);
  assert.equal(calls, 1, "the offered alternative passes without a model call");
  assert.equal((await s.check({ text: "something else", kind: "new", offered: true })).ok, true);
  assert.equal(calls, 2, "offered only counts for what was offered");
});

test("modelCheck: structured output from Haiku at low effort, its cost from usage, a refusal is a redirect", async () => {
  /** @type {any[]} */
  const sent = [];
  const client = (/** @type {any} */ reply) => ({ messages: { create: async (/** @type {any} */ body, /** @type {any} */ opts) => (sent.push({ body, opts }), reply) } });
  const ok = await modelCheck(client({ stop_reason: "end_turn", usage: { input_tokens: 700, output_tokens: 60 }, content: [{ type: "text", text: JSON.stringify({ verdict: "pass", alternative: "", why: "" }) }] }), "a zombie game", { kind: "new" });
  assert.equal(ok.verdict, "pass");
  assert.ok(Math.abs(/** @type {number} */ (ok.cost) - (700 * 0.1 + 60 * 0.5) / 1e6) < 1e-12);
  assert.equal(sent[0].body.model, "claude-haiku-5-5");
  assert.equal(sent[0].body.output_config.effort, "low");
  assert.equal(sent[0].body.output_config.format.type, "json_schema");
  assert.equal(sent[0].opts.maxRetries, 0);
  assert.match(sent[0].body.messages[0].content, /<idea>\na zombie game\n<\/idea>/);
  // An answer goes with its question, so the alternative still answers it (D276); a new idea has none.
  await modelCheck(client({ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: JSON.stringify({ verdict: "pass", alternative: "", why: "" }) }] }), "purple", { kind: "answer", question: "What color is the ship?" });
  assert.match(sent[1].body.messages[0].content, /<question>\nWhat color is the ship\?\n<\/question>[\s\S]*answer the kid typed or said to that question[\s\S]*<idea>\npurple\n<\/idea>/);
  assert.doesNotMatch(sent[0].body.messages[0].content, /<question>/);
  assert.match(SYSTEM, /must still answer that question/);
  const refused = await modelCheck(client({ stop_reason: "refusal", usage: { input_tokens: 700, output_tokens: 0 }, content: [] }), "x", { kind: "answer" });
  assert.equal(refused.verdict, "redirect");
  await assert.rejects(modelCheck(client({ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "not json" }] }), "x", { kind: "new" }));
});

test("E10 is kind: no scolding words, the alternative shown, and no coins used for a new idea", () => {
  const b = redirectBoard({ say: "Let's make it a little different. How about this?", alternative: "A shark that shouts BLUB", answer: false });
  assert.equal(b.board, "E10");
  const words = [b.title, ...b.blocks.map((x) => x.text), ...b.tiles.map((t) => t.text)].join(" | ");
  assert.doesNotMatch(words, NO_SCOLD);
  assert.match(words, /A shark that shouts BLUB/);
  assert.match(words, /No coins were used/);
  assert.equal(b.tiles.length, 3);
  assert.match(redirectBoard({ alternative: "x", answer: true }).tiles[2].text, /question/);
});

/** A Studio that records what reached it. */
function fakeStudio() {
  const calls = { start: /** @type {any[]} */ ([]), answer: /** @type {any[]} */ ([]) };
  let pending = /** @type {any} */ ({ id: 7, kind: "question", question: "What does the shark say?" });
  return {
    calls,
    setPending: (/** @type {any} */ p) => (pending = p),
    studio: /** @type {any} */ ({
      state: () => ({ phase: pending ? "running" : "idle", maker: "milo", pending }),
      subscribe: () => () => {},
      start: (/** @type {any} */ a) => calls.start.push(a),
      answer: (/** @type {any} */ a) => calls.answer.push(a),
    }),
  };
}

test("the service: a redirected idea starts no session; the alternative, picked, does; a redirected answer leaves the question waiting", async () => {
  const data = tmp();
  const f = fakeStudio();
  f.setPending(null);
  const makers = makersStore({ file: path.join(data, "makers.json") });
  makers.add("Milo");
  const screen = createScreener({ logsDir: path.join(data, "logs"), model: tableModel });
  const s = await startService({ studio: f.studio, makers, speech: stubSpeech(), libraryDir: path.join(data, "carts"), logsDir: path.join(data, "logs"), port: 0, screen });
  const post = (/** @type {string} */ u, /** @type {any} */ body) => fetch(s.url + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const bad = await post("/api/studio/start", { maker: "milo", request: TABLE[12].text });
    assert.equal(bad.status, 200);
    assert.deepEqual([bad.body.ok, bad.body.why], [false, "redirect"]);
    assert.ok(bad.body.redirect.alternative);
    assert.equal(f.calls.start.length, 0, "no session, so no coins");
    const took = await post("/api/studio/start", { maker: "milo", request: bad.body.redirect.alternative, offered: true });
    assert.equal(took.body.ok, true);
    assert.equal(f.calls.start.length, 1);
    const fine = await post("/api/studio/start", { maker: "milo", request: "a zombie shooter where you blast zombies with a laser gun" });
    assert.equal(fine.body.ok, true, "game violence goes straight through");

    f.setPending({ id: 7, kind: "question", question: "What does the shark say?" });
    const word = await post("/api/studio/answer", { id: 7, choice: "C", said: "call the bad guy a retard" });
    assert.deepEqual([word.body.ok, word.body.why], [false, "redirect"]);
    assert.equal(f.calls.answer.length, 0, "the question is still waiting");
    assert.equal((await post("/api/studio/answer", { id: 7, choice: "A" })).body.ok, true, "a tile answer isn't screened");
    assert.equal((await post("/api/studio/answer", { id: 7, choice: "C", said: "purple" })).body.ok, true);
    assert.equal(f.calls.answer.length, 2);
    const log = readLog(path.join(data, "logs", "screening.jsonl"));
    assert.deepEqual(log.map((l) => [l.kind, l.outcome]), [["new", "redirected"], ["new", "pass"], ["new", "pass"], ["answer", "redirected"], ["answer", "pass"]]);
    assert.deepEqual(log.map((l) => l.question ?? null), [null, null, null, "What does the shark say?", "What does the shark say?"], "an answer is logged with its question (D276)");
    // On the plan, "change" words go with what they change.
    f.setPending({ id: 8, kind: "plan", summary: "A shark eats fish" });
    assert.equal((await post("/api/studio/answer", { id: 8, choice: "change", said: "make it faster" })).body.ok, true);
    assert.match(readLog(path.join(data, "logs", "screening.jsonl")).at(-1).question, /plan.*A shark eats fish/);
  } finally {
    await s.close();
  }
});

test("without a screener the service works as before", () => {
  const h = createServiceHandler({ studio: fakeStudio().studio, makers: makersStore({ file: path.join(tmp(), "m.json") }), speech: stubSpeech(), libraryDir: tmp(), logsDir: tmp() });
  assert.equal(typeof h, "function");
});

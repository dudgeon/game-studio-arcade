// The session driver against scripted event streams.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi } from "../test-support/mock-api.js";
import { runSession } from "../src/driver.js";
import { replayAnswerer } from "../src/answers.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const frogScript = JSON.parse(fs.readFileSync(path.join(fixtures, "frog-hop/session.json"), "utf8"));
const frogAnswers = JSON.parse(fs.readFileSync(path.join(fixtures, "frog-hop/answers.json"), "utf8"));

const SESSION = { agentId: "agent_x", agentVersion: 3, environmentId: "env_x", kitFileId: "file_kit", budgetCents: 300 };

function run(api, answerer, extra = {}) {
  const lines = [];
  const p = runSession({
    api,
    session: SESSION,
    request: "A frog game",
    maker: "A",
    answerer,
    ui: { progress: (s) => lines.push(s) },
    ...extra,
  });
  return p.then((r) => ({ r, lines }));
}

const toolUse = (id, name, input) => ({ emit: { id, type: "agent.custom_tool_use", name, input } });
const ask = (id, q) => toolUse(id, "ask_player", { question: q, option_a: "One", option_b: "Two" });
const idle = (id, type, extra = {}) => ({ emit: { id, type: "session.status_idle", stop_reason: { type, ...extra } } });

test("relays questions, the plan and progress; opens the stream before sending", async () => {
  const m = mockApi(frogScript, { usage: { list_cost: { amount: "143", currency: "USD" }, active_seconds: 312 } });
  const { r, lines } = await run(m.api, replayAnswerer(frogAnswers));

  assert.deepEqual(m.problems, []);
  assert.equal(m.position, frogScript.steps.length, "the whole script ran");
  assert.deepEqual(m.calls.slice(0, 3), ["createSession", "openStream", "send:user.message"]);

  assert.equal(r.sessionId, "sesn_mock_01");
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.endedBy, "answers");
  assert.deepEqual(
    r.turns.map((t) => [t.question, t.choice, t.said]),
    [
      ["What does the frog dodge?", "A", null],
      ["How fast are the cars?", "C", "medium and it gets faster"],
    ],
  );
  assert.deepEqual(r.planTurns.map((p) => [p.choice, p.rules.length]), [["change", 4], ["build", 5]]);
  assert.equal(r.usage.list_cost.amount, "143", "the session object's usage wins over the stream's");
  assert.equal(r.lastMessage, "Built Frog Hop. All four auto rules pass after one fix.");

  // tell_player lines and tool-derived lines, no repeats in a row, nothing technical.
  assert.ok(lines.includes("Unpacking my toolbox"));
  assert.ok(lines.includes("Writing down the rules"));
  assert.ok(lines.includes("Testing the game"));
  assert.ok(lines.includes("Playing your game to test it"));
  assert.ok(lines.includes("Packing up your game"));
  for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1]);
  assert.ok(lines.every((l) => !/\/|\.js|tar /.test(l)), "no paths or commands shown to the player");

  // Every custom tool call got exactly one result.
  const ids = m.sent.filter((e) => e.type === "user.custom_tool_result").map((e) => e.custom_tool_use_id);
  assert.deepEqual(ids, ["ctu_01", "ctu_02", "ctu_03", "ctu_04", "ctu_05", "ctu_06"]);
});

test("D ends the questions; a later ask_player gets D automatically", async () => {
  const m = mockApi({
    steps: [
      { await_message: true },
      ask("q1", "Two players?"),
      { await_result: "q1", expect: { choice: "D" } },
      ask("q2", "One more?"),
      { await_result: "q2", expect: { choice: "D" } },
      toolUse("p1", "show_plan", { summary: "s", rules: [{ id: "R1", kind: "auto", text: "t" }] }),
      { await_result: "p1", expect: { choice: "build" } },
      idle("i1", "end_turn"),
    ],
  });
  const asked = [];
  const answerer = {
    async question(q) {
      asked.push(q.question);
      return /** @type {const} */ ({ choice: "D" });
    },
    async plan() {
      return /** @type {const} */ ({ choice: "build" });
    },
  };
  const { r } = await run(m.api, answerer);
  assert.deepEqual(m.problems, []);
  assert.deepEqual(asked, ["Two players?"], "the player is asked only once");
  assert.equal(r.endedBy, "make_it_now");
  assert.deepEqual(r.turns.map((t) => [t.choice, Boolean(t.auto)]), [["D", false], ["D", true]]);
  assert.ok(r.notes.includes("asked_after_make_it_now"));
});

test("a tool call missed by the stream is found in the history and answered", async () => {
  const m = mockApi({
    steps: [
      { await_message: true },
      { drop: { id: "q1", type: "agent.custom_tool_use", name: "ask_player", input: { question: "Hidden?", option_a: "Yes", option_b: "No" } } },
      idle("i1", "requires_action", { event_ids: ["q1"] }),
      { await_result: "q1", expect: { choice: "B" } },
      idle("i2", "end_turn"),
    ],
  });
  const { r } = await run(m.api, replayAnswerer({ questions: [{ choice: "B" }] }));
  assert.deepEqual(m.problems, []);
  assert.ok(m.calls.includes("listEvents"));
  assert.ok(r.notes.includes("recovered_tool_call"));
  assert.equal(r.turns[0].question, "Hidden?");
});

test("a dropped stream reconnects, replays history without repeats, and carries on", async () => {
  const m = mockApi({
    steps: [
      { await_message: true },
      ask("q1", "First?"),
      { await_result: "q1", expect: { choice: "A" } },
      { disconnect: true },
      ask("q2", "Second?"),
      { await_result: "q2", expect: { choice: "B" } },
      idle("i1", "end_turn"),
    ],
  });
  const { r } = await run(m.api, replayAnswerer({ questions: [{ choice: "A" }, { choice: "B" }] }));
  assert.deepEqual(m.problems, []);
  assert.ok(r.notes.includes("reconnected"));
  assert.equal(m.calls.filter((c) => c === "openStream").length, 2);
  assert.deepEqual(r.turns.map((t) => t.question), ["First?", "Second?"], "q1 isn't asked twice after the replay");
});

test("budget_reached ends the session and is reported", async () => {
  const m = mockApi({
    steps: [{ await_message: true }, { emit: { id: "u1", type: "session.usage", usage: { list_cost: { amount: "301", currency: "USD" } } } }, idle("i1", "budget_reached")],
  });
  const { r } = await run(m.api, replayAnswerer({}));
  assert.equal(r.stopReason, "budget_reached");
  assert.equal(r.usage.list_cost.amount, "301", "stream usage is kept when the session has none");
});

test("a stream that never finishes gives up after the reconnect limit", async () => {
  const m = mockApi({ steps: [{ await_message: true }, { disconnect: true }] });
  const { r } = await run(m.api, replayAnswerer({}), { maxReconnects: 2 });
  assert.equal(r.stopReason, "stream_lost");
  assert.equal(m.calls.filter((c) => c === "openStream").length, 3);
});

test("replay runs out: D, and replay_exhausted is noted", async () => {
  const m = mockApi({
    steps: [{ await_message: true }, ask("q1", "A?"), { await_result: "q1", expect: { choice: "A" } }, ask("q2", "B?"), { await_result: "q2", expect: { choice: "D" } }, idle("i", "end_turn")],
  });
  const { r } = await run(m.api, replayAnswerer({ questions: [{ choice: "A" }] }));
  assert.deepEqual(m.problems, []);
  assert.ok(r.notes.includes("replay_exhausted"));
  assert.equal(r.endedBy, "make_it_now");
});

test("an unknown custom tool gets an error result instead of hanging", async () => {
  const m = mockApi({ steps: [{ await_message: true }, toolUse("x1", "launch_rocket", {}), { await_result: "x1" }, idle("i", "end_turn")] });
  const { r } = await run(m.api, replayAnswerer({}));
  assert.match(m.results.get("x1"), /unknown tool launch_rocket/);
  assert.ok(r.notes.includes("unknown_tool:launch_rocket"));
});

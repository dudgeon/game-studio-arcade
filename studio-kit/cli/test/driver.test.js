// The session driver against scripted event streams.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi } from "../test-support/mock-api.js";
import { nameFor, runSession } from "../src/driver.js";
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
  assert.ok(lines.includes("Getting my tools out"));
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

test("an extra plan during a replay is noted as a re-plan, not as running out", async () => {
  const plan = (id) => toolUse(id, "show_plan", { summary: "s", rules: [] });
  const m = mockApi({ steps: [{ await_message: true }, plan("p1"), { await_result: "p1" }, plan("p2"), { await_result: "p2", expect: { choice: "build" } }, idle("i", "end_turn")] });
  const { r } = await run(m.api, replayAnswerer({ questions: [], plan: [{ choice: "build" }] }));
  assert.ok(r.notes.includes("replay_replanned"));
  assert.ok(!r.notes.includes("replay_exhausted"));
});

test("the plan reaches the player whole: how to play and the four rules that matter (D210, D215)", async () => {
  const input = { summary: "s", controls: "Stick: hop. A: start.", top_rules: ["R2", "R1"], rules: [{ id: "R1", kind: "auto", text: "t" }, { id: "R2", kind: "you-check", text: "u", was: "old" }], changes: [{ id: "R2", text: "c" }] };
  const m = mockApi({ steps: [{ await_message: true }, toolUse("p1", "show_plan", input), { await_result: "p1", expect: { choice: "build" } }, idle("i", "end_turn")] });
  /** @type {any[]} */
  const shown = [];
  const { r } = await run(m.api, { async question() { return /** @type {const} */ ({ choice: "D" }); }, async plan(p) { shown.push(p); return /** @type {const} */ ({ choice: "build" }); } });
  assert.deepEqual(shown, [input], "nothing the agent sent is dropped");
  assert.equal(r.planTurns[0].controls, "Stick: hop. A: start.");
  assert.deepEqual(r.planTurns[0].top_rules, ["R2", "R1"]);
});

test("an unknown custom tool gets an error result instead of hanging", async () => {
  const m = mockApi({ steps: [{ await_message: true }, toolUse("x1", "launch_rocket", {}), { await_result: "x1" }, idle("i", "end_turn")] });
  const { r } = await run(m.api, replayAnswerer({}));
  assert.match(m.results.get("x1"), /unknown tool launch_rocket/);
  assert.ok(r.notes.includes("unknown_tool:launch_rocket"));
});

test("the plan reaches the screen in kid words: seconds, never frames or milliseconds (D304)", async () => {
  const { kidWords } = await import("../src/kidwords.js");
  assert.equal(kidWords("After rows are cleared the cat dances for 90 frames.").text, "After rows are cleared the cat dances for 1.5 seconds.");
  assert.equal(kidWords("the frog is back at the start 30 frames later").text, "the frog is back at the start half a second later");
  assert.equal(kidWords("Holding down drops one row every 3 frames.").text, "Holding down drops one row every split second.");
  assert.equal(kidWords("It speeds up by 0.25 pixels per frame.").text, "It speeds up by 15 pixels a second.");
  assert.equal(kidWords("A flash for 500 ms.").text, "A flash for half a second.");
  assert.equal(kidWords("Catch a fish: 10 points.").changed, false, "plain words stay as they are");
  const input = { summary: "s", controls: "Stick: hop.", rules: [{ id: "R1", kind: "auto", text: "The cat dances for 90 frames." }, { id: "R2", kind: "auto", text: "Back in 30 frames.", was: "Back in 60 frames." }], changes: [{ id: "R2", text: "Now 30 frames, not 60." }] };
  const m = mockApi({ steps: [{ await_message: true }, toolUse("p1", "show_plan", input), { await_result: "p1", expect: { choice: "build" } }, idle("i", "end_turn")] });
  /** @type {any[]} */
  const shown = [];
  const { r } = await run(m.api, { async question() { return /** @type {const} */ ({ choice: "D" }); }, async plan(p) { shown.push(p); return /** @type {const} */ ({ choice: "build" }); } });
  const words = JSON.stringify(shown[0]);
  assert.doesNotMatch(words, /frame/i, "no frames on the kid's screen");
  assert.equal(shown[0].rules[0].text, "The cat dances for 1.5 seconds.");
  assert.equal(shown[0].rules[1].was, "Back in 1 second.");
  assert.ok(r.notes.includes("plan_reworded_for_kids"), "the record says the brief wasn't followed");
});

test("the first question checks Claude heard the idea right, and a spoken fix reaches Claude word for word (D308)", async () => {
  const restate = { question: "A falling-candy game where the cat is happy after 20 lines?", option_a: "Yes, that's it", option_b: "Not quite" };
  const m = mockApi({
    steps: [
      { await_message: true },
      toolUse("q1", "ask_player", restate),
      { await_result: "q1", expect: { choice: "C", said: "every time you clear a line he dances" } },
      ask("q2", "How fast does it fall?"),
      { await_result: "q2", expect: { choice: "D" } },
      toolUse("p1", "show_plan", { summary: "s", controls: "Stick: slide.", rules: [{ id: "R1", kind: "auto", text: "The cat dances after each line." }] }),
      { await_result: "p1", expect: { choice: "build" } },
      idle("i1", "end_turn"),
    ],
  });
  /** @type {any[]} */
  const asked = [];
  const answerer = {
    /** @param {any} q */
    async question(q) {
      asked.push(q);
      return asked.length === 1 ? /** @type {const} */ ({ choice: "C", said: "every time you clear a line he dances" }) : /** @type {const} */ ({ choice: "D" });
    },
    async plan() {
      return /** @type {const} */ ({ choice: "build" });
    },
  };
  const { r } = await run(m.api, answerer);
  assert.deepEqual(m.problems, []);
  assert.deepEqual(asked[0], restate, "the restated idea reaches the screen as Claude wrote it, with its two tiles");
  assert.deepEqual(r.turns[0].question, restate.question);
  assert.deepEqual([r.turns[0].choice, r.turns[0].said], ["C", "every time you clear a line he dances"], "the correction is on the record");
});

// ---------- the name question (D471) ----------

const nameUse = (id, input = {}) => toolUse(id, "name_version", { option_a: "Faster logs", option_b: "Turbo river", pick: "B", ...input });
const nameScript = (input) => mockApi({ steps: [{ await_message: true }, nameUse("n1", input), { await_result: "n1" }, idle("i", "end_turn")] });
/** An answerer whose name question gets `a`. */
const naming = (a, seen = []) => ({ ...replayAnswerer({}), name: async (q) => (seen.push(q), a) });

test("name_version: a tile's name comes back as the name, and the turn is kept apart from the game's questions", async () => {
  const m = nameScript();
  const seen = [];
  const named = [];
  const { r } = await run(m.api, naming({ choice: "A" }, seen), { naming: { taken: [] }, ui: { progress: () => {}, named: (n) => named.push(n) } });
  assert.deepEqual(seen, [{ option_a: "Faster logs", option_b: "Turbo river", pick: "B" }]);
  assert.deepEqual(JSON.parse(m.results.get("n1")), { choice: "A", name: "Faster logs" });
  assert.deepEqual(r.nameTurn, { option_a: "Faster logs", option_b: "Turbo river", pick: "B", choice: "A", said: null, name: "Faster logs", picked: "tile" });
  assert.deepEqual(r.turns, []);
  assert.equal(r.endedBy, "answers", "D on the name question isn't Make it now");
  assert.deepEqual(named, ["Faster logs"]);
});

test("name_version: You pick is Claude's pick; Something else is the player's own words, tidied", async () => {
  const d = nameScript();
  const picked = await run(d.api, naming({ choice: "D" }), { naming: { taken: [] } });
  assert.deepEqual(JSON.parse(d.results.get("n1")), { choice: "D", name: "Turbo river" });
  assert.equal(picked.r.nameTurn?.picked, "claude");
  assert.equal(picked.r.endedBy, "answers");

  const c = nameScript();
  const said = await run(c.api, naming({ choice: "C", said: " mega frog. " }), { naming: { taken: [] } });
  assert.deepEqual(JSON.parse(c.results.get("n1")), { choice: "C", said: " mega frog. ", name: "Mega frog" });
  assert.deepEqual([said.r.nameTurn?.name, said.r.nameTurn?.picked, said.r.nameTurn?.said], ["Mega frog", "said", " mega frog. "]);
});

test("name_version: the player's words are never cut; too long or already used goes back to Claude with no name", async () => {
  for (const words of ["the one where every log goes much faster", "turbo RIVER"]) {
    const m = nameScript();
    const { r } = await run(m.api, naming({ choice: "C", said: words }), { naming: { taken: ["Turbo river"] } });
    assert.deepEqual(JSON.parse(m.results.get("n1")), { choice: "C", said: words });
    assert.equal(r.nameTurn?.name, null);
  }
});

test("nameFor: Claude's own names are cut to fit, a used one is skipped on You pick", () => {
  const q = { option_a: "Much much faster logs", option_b: "Turbo river", pick: "A" };
  assert.deepEqual(nameFor(q, { choice: "A" }, []), { name: "Much much faster", picked: "tile" });
  assert.deepEqual(nameFor(q, { choice: "D" }, ["much much faster"]), { name: "Turbo river", picked: "claude" });
  assert.deepEqual(nameFor(q, { choice: "D" }, ["Much much faster", "Turbo river"]), { name: null, picked: "claude" });
  assert.deepEqual(nameFor(q, { choice: "B" }, ["Turbo River"]), { name: null, picked: "tile" });
});

test("name_version: with no way to ask, it's You pick; for a version that takes its title, it's turned down and noted", async () => {
  // A recording from before names, and an answerer with no name question at all (a session picked up after a restart).
  const { name: _, ...noName } = replayAnswerer({});
  for (const answerer of [replayAnswerer({}), noName]) {
    const m = nameScript();
    const { r } = await run(m.api, answerer, { naming: { taken: [] } });
    assert.deepEqual(JSON.parse(m.results.get("n1")), { choice: "D", name: "Turbo river" });
    assert.equal(r.nameTurn?.picked, "claude");
  }

  const off = nameScript();
  const other = await run(off.api, naming({ choice: "A" }));
  assert.match(off.results.get("n1"), /goes by the game's title/);
  assert.equal(other.r.nameTurn, null);
  assert.ok(other.r.notes.includes("named_a_version_that_takes_its_title"));
});

test("a replayed recording answers the name question with its recorded answer", async () => {
  const m = nameScript();
  const { r } = await run(m.api, replayAnswerer({ name: { choice: "A" } }), { naming: { taken: [] } });
  assert.equal(r.nameTurn?.name, "Faster logs");
});

// Replays the event stream recorded from the first real `studio make`
// (sesn_01UBPbematoWWGK1foPSzfo2, 2026-11-08) through the driver, with the
// recorded answers, and checks the driver relays it the same way again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mockApi } from "../test-support/mock-api.js";
import { runSession } from "../src/driver.js";
import { replayAnswerer } from "../src/answers.js";

const dir = new URL("../fixtures/penguin-catch/", import.meta.url);
const events = fs.readFileSync(new URL("events.jsonl", dir), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const answers = JSON.parse(fs.readFileSync(new URL("answers.json", dir), "utf8"));

/** Turn a recorded stream into mock steps: our own events become waits. */
function stepsFrom(recorded) {
  const steps = [];
  for (const e of recorded) {
    if (e.type === "user.message") steps.push({ await_message: true });
    else if (e.type === "user.custom_tool_result") steps.push({ await_result: e.custom_tool_use_id, expect: JSON.parse(e.content[0].text) });
    else if (e.type.startsWith("user.")) continue;
    else steps.push({ emit: e });
  }
  return { steps };
}

test("the recorded penguin-catch stream relays the same turns, plan and ending", async () => {
  const m = mockApi(stepsFrom(events), { timeoutMs: 5000 });
  const progress = [];
  const r = await runSession({
    api: m.api,
    session: { agentId: "agent_x", environmentId: "env_x", kitFileId: "file_k", budgetCents: 300 },
    request: answers.request,
    maker: "A",
    answerer: replayAnswerer(answers),
    ui: { progress: (s) => progress.push(s) },
  });
  assert.deepEqual(m.problems, [], "every tool result matches what was sent live");
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.endedBy, "answers");
  assert.deepEqual(
    r.turns.map((t) => [t.question, t.choice]),
    [
      ["What happens if you catch a boot?", "A"],
      ["How should the game get harder?", "B"],
      ["How does the penguin move?", "C"],
    ],
  );
  assert.equal(r.turns[2].said, "slides left and right but really slippery like on ice");
  assert.deepEqual(r.planTurns.map((p) => [p.choice, p.rules.length]), [["build", 14]]);
  assert.equal(r.usage.list_cost.amount, "68", "the last session.usage on the stream");
  assert.ok(progress.includes("All done! Your penguin game is ready to play"));
});
